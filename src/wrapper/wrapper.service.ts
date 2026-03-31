// @spec FR-036: Wrapper generation, FR-037: Wrapper execution logic, FR-039: Directory creation, FR-040: Wrapper removal, FR-041: Wrapper path — .specs/features/005-wrapper-script-generation/spec.md#fr-036

import { join } from "node:path";
import { mkdir, chmod, unlink, readdir } from "node:fs/promises";
import type { WrapperConfig } from "./wrapper.types";
import { MAX_OUTPUT_BYTES, NOTIFY_STDERR_MAX_CHARS } from "./wrapper.types";
import { WrapperGenerationError } from "./wrapper.errors";

/**
 * Static bash body for wrapper scripts.
 * Uses {{COMMAND}} as placeholder for the actual command.
 * All bash variables use $ syntax which must not be interpolated by TypeScript.
 *
 * Execution flow:
 *   1. Create temp files for stdout/stderr capture
 *   2. Run the command, redirect output to temp files
 *   3. Capture exit code, end timestamp, and duration
 *   4. _truncate() reads the first CRONSHED_MAX_OUTPUT bytes; appends "... [truncated]" if longer
 *   5. _json_escape() makes stdout/stderr safe for embedding in a JSON string:
 *      backslashes → \\, double quotes → \", newlines → \n, CR → \r, tabs → \t
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
	"printf '{\"timestamp\":\"%s\",\"exitCode\":%d,\"durationMs\":%d,\"stdout\":%s,\"stderr\":%s}\\n' \"$_timestamp\" \"$_exit_code\" \"$_duration_ms\" \"$_stdout_json\" \"$_stderr_json\" >> \"$CRONSHED_LOG_FILE\"",
	"",
	'rm -f "$_stdout_file" "$_stderr_file"',
	"exit $_exit_code",
	"",
].join("\n");

/**
 * Notification block inserted into wrapper scripts when notify is enabled.
 * Uses {{TASK_NAME}} and {{NOTIFY_MAX}} as placeholders.
 * @spec FR-048: Notification block — .specs/features/008-failure-notifications/spec.md#fr-048
 * @spec FR-049: Stderr truncation for notification — .specs/features/008-failure-notifications/spec.md#fr-049
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
	 * @param task Task with name, command, and notify flag
	 * @returns Absolute path to the generated wrapper script
	 * @throws WrapperGenerationError if generation fails
	 */
	// @spec FR-050: Pass notify to buildScript — .specs/features/008-failure-notifications/spec.md#fr-050
	async generate(task: { name: string; command: string; notify?: boolean }): Promise<string> {
		const wrapperPath = this.getWrapperPath(task.name);
		const logPath = join(this.logsDir, `${task.name}.jsonl`);

		const config: WrapperConfig = {
			taskName: task.name,
			command: task.command,
			logPath,
			maxOutputBytes: MAX_OUTPUT_BYTES,
			notify: task.notify ?? false,
		};

		try {
			await mkdir(this.wrappersDir, { recursive: true });
			const script = this.buildScript(config);
			await Bun.write(wrapperPath, script);
			await chmod(wrapperPath, 0o755);
		} catch (err) {
			throw new WrapperGenerationError(
				task.name,
				err instanceof Error ? err : undefined,
			);
		}

		return wrapperPath;
	}

	/**
	 * Remove a wrapper script for a task. No-op if file does not exist.
	 * @param taskName The task name
	 */
	// @spec FR-040: Silent removal — .specs/features/005-wrapper-script-generation/spec.md#fr-040
	async remove(taskName: string): Promise<void> {
		const wrapperPath = this.getWrapperPath(taskName);
		try {
			await unlink(wrapperPath);
		} catch (err: unknown) {
			// ENOENT is expected — wrapper may already be deleted
			if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
				return;
			}
			throw err;
		}
	}

	/**
	 * Regenerate all wrappers from tasks and remove orphaned wrappers.
	 * @param tasks Array of tasks with name, command, and notify flag
	 */
	// @spec FR-044: Sync regenerates wrappers — .specs/features/005-wrapper-script-generation/spec.md#fr-044
	// @spec FR-053: Sync passes notify per task — .specs/features/008-failure-notifications/spec.md#fr-053
	async syncWrappers(tasks: { name: string; command: string; notify?: boolean }[]): Promise<void> {
		// Generate all wrappers
		for (const task of tasks) {
			await this.generate(task);
		}

		// Remove orphaned wrappers
		const taskNames = new Set(tasks.map((t) => t.name));
		try {
			const files = await readdir(this.wrappersDir);
			for (const file of files) {
				if (!file.endsWith(".sh")) continue;
				const name = file.slice(0, -3); // Remove .sh
				if (!taskNames.has(name)) {
					await unlink(join(this.wrappersDir, file));
				}
			}
		} catch (err: unknown) {
			// If wrappers dir doesn't exist yet, nothing to clean
			if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
				return;
			}
			throw err;
		}
	}

	/**
	 * Get the absolute path to a wrapper script.
	 * @param taskName The task name
	 * @returns Absolute path to the wrapper .sh file
	 */
	// @spec FR-041: Wrapper path for crontab command — .specs/features/005-wrapper-script-generation/spec.md#fr-041
	getWrapperPath(taskName: string): string {
		return join(this.wrappersDir, `${taskName}.sh`);
	}

	/**
	 * Build the bash wrapper script content.
	 * When notify is true, includes a notification block that calls cc-hub on failure.
	 * @param config Wrapper configuration
	 * @returns Complete bash script as a string
	 */
	// @spec FR-037: Wrapper script content — .specs/features/005-wrapper-script-generation/spec.md#fr-037
	// @spec FR-048: Notification block — .specs/features/008-failure-notifications/spec.md#fr-048
	buildScript(config: WrapperConfig): string {
		const { taskName, command, logPath, maxOutputBytes, notify } = config;
		const logsDir = this.logsDir;
		const timestamp = new Date().toISOString();

		// Header with interpolated values
		let script = "#!/bin/bash\n";
		script += "# cronshed wrapper for: " + taskName + "\n";
		script += "# Command: " + command + "\n";
		script += "# Generated: " + timestamp + "\n";
		script += "# DO NOT EDIT — regenerated by cronshed\n\n";

		// Hardcoded paths (resolved at generation time, not runtime)
		script += 'CRONSHED_LOG_DIR="' + logsDir + '"\n';
		script += 'CRONSHED_LOG_FILE="' + logPath + '"\n';
		script += "CRONSHED_MAX_OUTPUT=" + maxOutputBytes + "\n\n";

		// Core wrapper body: execute, capture, log
		let body = WRAPPER_SCRIPT_BODY.replace("{{COMMAND}}", command);

		// @spec FR-048: Insert notification block before cleanup when notify enabled
		if (notify) {
			const notifyBlock = NOTIFY_BLOCK
				.replace(/\{\{TASK_NAME\}\}/g, taskName)
				.replace(/\{\{NOTIFY_MAX\}\}/g, String(NOTIFY_STDERR_MAX_CHARS));
			// Insert notification block before temp file cleanup
			body = body.replace(
				'rm -f "$_stdout_file" "$_stderr_file"',
				notifyBlock + '\nrm -f "$_stdout_file" "$_stderr_file"',
			);
		}

		script += body;
		return script;
	}
}
