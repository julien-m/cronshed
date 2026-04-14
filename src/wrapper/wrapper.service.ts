// @spec FR-036: Wrapper generation, FR-037: Wrapper execution logic, FR-039: Directory creation, FR-040: Wrapper removal, FR-041: Wrapper path — .specs/features/005-wrapper-script-generation/spec.md#fr-036
// @spec FR-086: Flock injection, FR-089: Timeout tool check, FR-090: Timeout wrapping, FR-097: PID in lock, FR-098: Lock hash — .specs/features/015-wrapper-protections/spec.md#fr-086

import { chmod, mkdir, readdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { TimeoutToolMissingError, WrapperGenerationError } from "./wrapper.errors";
import type { WrapperConfig } from "./wrapper.types";
import { MAX_OUTPUT_BYTES, NOTIFY_STDERR_MAX_CHARS } from "./wrapper.types";

/**
 * Static bash body for wrapper scripts.
 * Uses {{COMMAND}} as placeholder for the actual command.
 *
 * Execution flow:
 *   1. Create temp files for stdout/stderr capture
 *   2. Run the command, redirect output to temp files
 *   3. Capture exit code, end timestamp, and duration
 *   4. _truncate() reads the first CRONSHED_MAX_OUTPUT bytes
 *   5. _json_escape() makes stdout/stderr safe for JSON
 *   6. Append a single JSON log entry to the JSONL log file
 *   7. Clean up temp files and propagate the original exit code
 */
// prettier-ignore
const WRAPPER_SCRIPT_BODY = [
	'mkdir -p "$CRONSHED_LOG_DIR"',
	"",
	"_start_epoch=$(date +%s)",
	"_stdout_file=$(mktemp)",
	"_stderr_file=$(mktemp)",
	"",
	'{{COMMAND}} >"$_stdout_file" 2>"$_stderr_file"',
	"_exit_code=$?",
	"",
	"_end_epoch=$(date +%s)",
	"_duration_ms=$(( (_end_epoch - _start_epoch) * 1000 ))",
	'_timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")',
	"",
	"_truncate() {",
	"  local content",
	'  content=$(head -c $CRONSHED_MAX_OUTPUT "$1")',
	'  if [ $(wc -c < "$1") -gt $CRONSHED_MAX_OUTPUT ]; then',
	'    echo "${content}... [truncated]"',
	"  else",
	'    echo "$content"',
	"  fi",
	"}",
	"",
	'_stdout=$(_truncate "$_stdout_file")',
	'_stderr=$(_truncate "$_stderr_file")',
	"",
	"_json_escape() {",
	'  local s="$1"',
	'  s="${s//\\\\/\\\\\\\\}"',
	'  s="${s//\\"/\\\\\\"}"',
	"  s=\"${s//$'\\n'/\\\\n}\"",
	"  s=\"${s//$'\\r'/\\\\r}\"",
	"  s=\"${s//$'\\t'/\\\\t}\"",
	'  printf \'"%s"\' "$s"',
	"}",
	"",
	'_stdout_json=$(_json_escape "$_stdout")',
	'_stderr_json=$(_json_escape "$_stderr")',
	"",
	"{{LOG_PRINTF}}",
	"",
	'rm -f "$_stdout_file" "$_stderr_file"',
	"exit $_exit_code",
	"",
].join("\n");

/** Standard log printf without timedOut field. */
const STANDARD_LOG_PRINTF =
	'printf \'{"timestamp":"%s","exitCode":%d,"durationMs":%d,"stdout":%s,"stderr":%s}\\n\' "$_timestamp" "$_exit_code" "$_duration_ms" "$_stdout_json" "$_stderr_json" >> "$CRONSHED_LOG_FILE"';

/**
 * Log printf with timedOut field when timeout is configured.
 * Checks exit code 124 and non-empty timeout tool to determine timedOut.
 */
// prettier-ignore
const TIMEOUT_LOG_PRINTF = [
	'if [ "$_exit_code" -eq 124 ] && [ -n "$CRONSHED_TIMEOUT_CMD" ]; then',
	'  printf \'{"timestamp":"%s","exitCode":%d,"durationMs":%d,"stdout":%s,"stderr":%s,"timedOut":true}\\n\' "$_timestamp" "$_exit_code" "$_duration_ms" "$_stdout_json" "$_stderr_json" >> "$CRONSHED_LOG_FILE"',
	"else",
	'  printf \'{"timestamp":"%s","exitCode":%d,"durationMs":%d,"stdout":%s,"stderr":%s}\\n\' "$_timestamp" "$_exit_code" "$_duration_ms" "$_stdout_json" "$_stderr_json" >> "$CRONSHED_LOG_FILE"',
	"fi",
].join("\n");

/**
 * Notification block inserted into wrapper scripts when notify is enabled.
 * @spec FR-048: Notification block — .specs/features/008-failure-notifications/spec.md#fr-048
 */
// prettier-ignore
const NOTIFY_BLOCK = [
	"",
	"# --- Failure notification ---",
	"# @spec FR-048: Send Telegram alert on failure — .specs/features/008-failure-notifications/spec.md#fr-048",
	"if [ $_exit_code -ne 0 ]; then",
	"  if command -v cc-hub >/dev/null 2>&1; then",
	'    _notify_stderr=$(head -c {{NOTIFY_MAX}} "$_stderr_file")',
	'    if [ -z "$_notify_stderr" ]; then',
	'      _notify_stderr="no stderr output"',
	'    elif [ $(wc -c < "$_stderr_file") -gt {{NOTIFY_MAX}} ]; then',
	'      _notify_stderr="${_notify_stderr}..."',
	"    fi",
	'    cc-hub telegram send "[cronshed] Task \\"{{TASK_NAME}}\\" failed (exit code $_exit_code) at $_timestamp',
	'Stderr: $_notify_stderr"',
	"  fi",
	"fi",
	"",
].join("\n");

/**
 * Flock skip log entry (written when lock cannot be acquired).
 * @spec FR-087: Skip log entry format — .specs/features/015-wrapper-protections/spec.md#fr-087
 */
// prettier-ignore
const FLOCK_SKIP_BLOCK = [
	'    _pid_holder=$(lsof -t "$CRONSHED_LOCK_FILE" 2>/dev/null | head -1)',
	'    _skipped_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")',
	'    printf \'{"timestamp":"%s","exitCode":0,"skipped":true,"skippedAt":"%s","reason":"already running","pidHolder":%s}\\n\' \\',
	'      "$_skipped_at" "$_skipped_at" "${_pid_holder:-0}" >> "$CRONSHED_LOG_FILE"',
	"    exit 0",
].join("\n");

export class WrapperService {
	private readonly wrappersDir: string;
	private readonly logsDir: string;

	constructor(private readonly dataDir: string) {
		this.wrappersDir = join(dataDir, "wrappers");
		this.logsDir = join(dataDir, "logs");
	}

	/**
	 * Generate a wrapper script for a task.
	 * Creates the wrappers directory if needed, writes the script, sets 0755 permissions.
	 * @param task Task with name, command, notify, and optional protection fields
	 * @returns Absolute path to the generated wrapper script
	 * @throws WrapperGenerationError if generation fails
	 */
	// @spec FR-050: Pass notify to buildScript — .specs/features/008-failure-notifications/spec.md#fr-050
	// @spec FR-086: Flock injection, FR-098: Lock hash — .specs/features/015-wrapper-protections/spec.md#fr-086
	async generate(task: {
		name: string;
		command: string;
		notify?: boolean;
		allowParallel?: boolean;
		timeout?: string;
		configPath?: string;
	}): Promise<string> {
		const wrapperPath = this.getWrapperPath(task.name);
		const logPath = join(this.logsDir, `${task.name}.jsonl`);

		// Resolve timeout tool if timeout is needed
		let timeoutConfig: { seconds: number; tool: string } | undefined;
		if (task.timeout) {
			const { parseDuration } = await import("./duration");
			const seconds = parseDuration(task.timeout);
			const tool = await detectTimeoutPath();
			timeoutConfig = { seconds, tool };
		}

		// Compute lock hash if single-instance is enabled
		let lockFilePath: string | undefined;
		let locksDir: string | undefined;
		let flockPath: string | undefined;
		if (!task.allowParallel) {
			locksDir = join(this.dataDir, "locks");
			const configPath = task.configPath ?? join(this.dataDir, "tasks.json");
			const hash = computeLockHash(configPath, task.name);
			lockFilePath = `$CRONSHED_LOCK_DIR/${hash}.lock`;
			flockPath = await detectFlockPath();
		}

		const config: WrapperConfig = {
			taskName: task.name,
			command: task.command,
			logPath,
			maxOutputBytes: MAX_OUTPUT_BYTES,
			notify: task.notify ?? false,
			allowParallel: task.allowParallel ?? false,
			timeout: timeoutConfig,
			lockFilePath,
			locksDir,
			flockPath,
		};

		try {
			await mkdir(this.wrappersDir, { recursive: true });
			const script = this.buildScript(config);
			await Bun.write(wrapperPath, script);
			await chmod(wrapperPath, 0o755);
		} catch (err) {
			if (err instanceof TimeoutToolMissingError) throw err;
			throw new WrapperGenerationError(task.name, err instanceof Error ? err : undefined);
		}

		return wrapperPath;
	}

	/**
	 * Remove a wrapper script for a task. No-op if file does not exist.
	 */
	// @spec FR-040: Silent removal — .specs/features/005-wrapper-script-generation/spec.md#fr-040
	async remove(taskName: string): Promise<void> {
		const wrapperPath = this.getWrapperPath(taskName);
		try {
			await unlink(wrapperPath);
		} catch (err: unknown) {
			if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
				return;
			}
			throw err;
		}
	}

	/**
	 * Kill a running process for a task by reading its PID from the lock file.
	 * Kills the entire process tree (all descendants), then cleans up the lock file.
	 * No-op if lock file does not exist or process is not running.
	 * @param taskName The task name
	 * @param configPath Optional config file path (defaults to dataDir/tasks.json)
	 * @returns true if a process was killed, false otherwise
	 */
	async killRunningProcess(taskName: string, configPath?: string): Promise<boolean> {
		const resolvedConfigPath = configPath ?? join(this.dataDir, "tasks.json");
		const hash = computeLockHash(resolvedConfigPath, taskName);
		const locksDir = join(this.dataDir, "locks");
		const lockFilePath = join(locksDir, `${hash}.lock`);

		let pid: number;
		try {
			const content = await readFile(lockFilePath, "utf-8");
			pid = parseInt(content.trim(), 10);
		} catch {
			return false;
		}

		if (isNaN(pid) || pid <= 0) {
			try {
				await unlink(lockFilePath);
			} catch {}
			return false;
		}

		// Check if process is still running
		try {
			process.kill(pid, 0);
		} catch {
			// Process not running — clean up stale lock file
			try {
				await unlink(lockFilePath);
			} catch {}
			return false;
		}

		// Kill entire process tree (descendants first, then root)
		await killProcessTree(pid);

		// Clean up lock file
		try {
			await unlink(lockFilePath);
		} catch {}
		return true;
	}

	/**
	 * Regenerate all wrappers from tasks and remove orphaned wrappers.
	 */
	// @spec FR-044: Sync regenerates wrappers — .specs/features/005-wrapper-script-generation/spec.md#fr-044
	// @spec FR-086: Sync passes protection fields — .specs/features/015-wrapper-protections/spec.md#fr-086
	async syncWrappers(
		tasks: {
			name: string;
			command: string;
			notify?: boolean;
			allowParallel?: boolean;
			timeout?: string;
			configPath?: string;
		}[],
	): Promise<void> {
		for (const task of tasks) {
			await this.generate(task);
		}

		// Remove orphaned wrappers
		const taskNames = new Set(tasks.map((t) => t.name));
		try {
			const files = await readdir(this.wrappersDir);
			for (const file of files) {
				if (!file.endsWith(".sh")) continue;
				const name = file.slice(0, -3);
				if (!taskNames.has(name)) {
					await unlink(join(this.wrappersDir, file));
				}
			}
		} catch (err: unknown) {
			if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
				return;
			}
			throw err;
		}
	}

	/**
	 * Get the absolute path to a wrapper script.
	 */
	// @spec FR-041: Wrapper path for crontab — .specs/features/005-wrapper-script-generation/spec.md#fr-041
	getWrapperPath(taskName: string): string {
		return join(this.wrappersDir, `${taskName}.sh`);
	}

	/**
	 * Build the bash wrapper script content.
	 * When allowParallel is false, wraps execution in a flock block.
	 * When timeout is configured, wraps command with timeout tool.
	 * @param config Wrapper generation configuration
	 * @returns Full wrapper script content
	 */
	// @spec FR-037: Wrapper script content — .specs/features/005-wrapper-script-generation/spec.md#fr-037
	// @spec FR-086: Flock block, FR-090: Timeout wrapping, FR-091: timedOut field — .specs/features/015-wrapper-protections/spec.md#fr-086
	buildScript(config: WrapperConfig): string {
		const {
			taskName,
			command,
			logPath,
			maxOutputBytes,
			notify,
			allowParallel,
			timeout,
			lockFilePath,
			locksDir,
			flockPath,
		} = config;
		const logsDir = this.logsDir;
		const timestamp = new Date().toISOString();

		// Header
		let script = "#!/bin/bash\n";
		script += "# cronshed wrapper for: " + taskName + "\n";
		script += "# Command: " + command + "\n";
		script += "# Generated: " + timestamp + "\n";
		script += "# DO NOT EDIT — regenerated by cronshed\n\n";

		// Hardcoded paths
		script += 'CRONSHED_LOG_DIR="' + logsDir + '"\n';
		script += 'CRONSHED_LOG_FILE="' + logPath + '"\n';
		script += "CRONSHED_MAX_OUTPUT=" + maxOutputBytes + "\n";

		// Timeout variables
		if (timeout) {
			script += 'CRONSHED_TIMEOUT_CMD="' + timeout.tool + '"\n';
			script += "CRONSHED_TIMEOUT_SECS=" + timeout.seconds + "\n";
		} else {
			script += 'CRONSHED_TIMEOUT_CMD=""\n';
			script += "CRONSHED_TIMEOUT_SECS=0\n";
		}
		script += "\n";

		// Build the command invocation (with or without timeout wrapping)
		const actualCommand = timeout ? `$CRONSHED_TIMEOUT_CMD --foreground $CRONSHED_TIMEOUT_SECS ${command}` : command;

		// Build the log printf (with or without timedOut check)
		const logPrintf = timeout ? TIMEOUT_LOG_PRINTF : STANDARD_LOG_PRINTF;

		// Core body with command and log substitution
		let body = WRAPPER_SCRIPT_BODY.replace("{{COMMAND}}", actualCommand).replace("{{LOG_PRINTF}}", logPrintf);

		// Insert notification block before cleanup when notify enabled
		if (notify) {
			const notifyBlock = NOTIFY_BLOCK.replace(/\{\{TASK_NAME\}\}/g, taskName).replace(
				/\{\{NOTIFY_MAX\}\}/g,
				String(NOTIFY_STDERR_MAX_CHARS),
			);
			body = body.replace(
				'rm -f "$_stdout_file" "$_stderr_file"',
				notifyBlock + '\nrm -f "$_stdout_file" "$_stderr_file"',
			);
		}

		// Wrap in flock block if single-instance is enabled
		if (!allowParallel && lockFilePath && locksDir) {
			// Create log and lock directories before flock (skip block needs log dir)
			script += 'mkdir -p "$CRONSHED_LOG_DIR"\n';
			script += 'CRONSHED_LOCK_DIR="' + locksDir + '"\n';
			script += 'CRONSHED_LOCK_FILE="' + locksDir + "/" + lockFilePath.replace("$CRONSHED_LOCK_DIR/", "") + '"\n\n';
			script += 'mkdir -p "$CRONSHED_LOCK_DIR"\n\n';
			if (flockPath) {
				// Use absolute path resolved at generation time (cron PATH may not include flock)
				script += "(\n";
				script += "  " + flockPath + " -n 9 || {\n";
				script += FLOCK_SKIP_BLOCK + "\n";
				script += "  }\n";
				script += '  echo $$ > "$CRONSHED_LOCK_FILE"\n\n';
				// Indent the body inside the subshell
				script += indentBlock(body, "  ");
				script += '\n) 9>"$CRONSHED_LOCK_FILE"\n';
			} else {
				// flock not available at generation time — run without lock protection
				script += body;
			}
		} else {
			script += body;
		}

		return script;
	}
}

/**
 * Indent every non-empty line of a text block with a given prefix.
 */
function indentBlock(text: string, prefix: string): string {
	return text
		.split("\n")
		.map((line) => (line.trim() === "" ? "" : prefix + line))
		.join("\n");
}

// @spec FR-089: Detect timeout tool — .specs/features/015-wrapper-protections/spec.md#fr-089
/**
 * Detect which timeout tool is available on the system.
 * Checks gtimeout first (macOS with coreutils), then timeout (Linux).
 * @returns The name of the available timeout tool
 * @throws TimeoutToolMissingError if neither is found
 */
export async function detectTimeoutTool(): Promise<string> {
	const toolPath = await detectFirstCommandPath(["gtimeout", "timeout"]);
	if (toolPath) {
		const segments = toolPath.split("/");
		return segments[segments.length - 1] ?? toolPath;
	}
	throw new TimeoutToolMissingError();
}

/**
 * Detect the absolute path to flock.
 * @returns Absolute flock path when available; otherwise undefined
 */
export async function detectFlockPath(): Promise<string | undefined> {
	return detectFirstCommandPath(["flock"]);
}

/**
 * Detect the absolute path to the timeout tool.
 * Checks gtimeout first (macOS with coreutils), then timeout (Linux).
 * @returns Absolute path to timeout tool when available
 * @throws TimeoutToolMissingError if neither is found
 */
export async function detectTimeoutPath(): Promise<string> {
	const toolPath = await detectFirstCommandPath(["gtimeout", "timeout"]);
	if (toolPath) {
		return toolPath;
	}
	throw new TimeoutToolMissingError();
}

async function detectFirstCommandPath(commands: readonly string[]): Promise<string | undefined> {
	for (const command of commands) {
		const result = await Bun.$`which ${command}`.quiet().nothrow();
		if (result.exitCode === 0) {
			return result.text().trim();
		}
	}

	return undefined;
}

/**
 * Recursively kill a process and all its descendants.
 * Uses pgrep to find child PIDs, kills bottom-up to avoid orphans.
 */
async function killProcessTree(pid: number): Promise<void> {
	// Find all child PIDs
	const result = await Bun.$`pgrep -P ${pid}`.quiet().nothrow();
	if (result.exitCode === 0) {
		const childPids = result
			.text()
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((s) => parseInt(s, 10));
		// Kill children first (depth-first)
		for (const childPid of childPids) {
			await killProcessTree(childPid);
		}
	}

	// Kill this process
	try {
		process.kill(pid, "SIGTERM");
	} catch {}
}

// @spec FR-098: Lock hash computation — .specs/features/015-wrapper-protections/spec.md#fr-098
/**
 * Compute a SHA-256 hash for the lock file name.
 * Hash input is "<configFilePath>:<taskName>".
 * @param configPath Absolute path to the config file
 * @param taskName The task name
 * @returns Hex-encoded SHA-256 hash
 */
export function computeLockHash(configPath: string, taskName: string): string {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(`${configPath}:${taskName}`);
	return hasher.digest("hex");
}
