// @spec FR-036: Wrapper generation, FR-037: Wrapper execution logic, FR-039: Directory creation, FR-040: Wrapper removal, FR-041: Wrapper path — .specs/features/005-wrapper-script-generation/spec.md#fr-036

import { join } from "node:path";
import { mkdir, chmod, unlink, readdir } from "node:fs/promises";
import type { WrapperConfig } from "./wrapper.types";
import { MAX_OUTPUT_BYTES } from "./wrapper.types";
import { WrapperGenerationError } from "./wrapper.errors";

/**
 * Static bash body for wrapper scripts.
 * Uses {{COMMAND}} as placeholder for the actual command.
 * All bash variables use $ syntax which must not be interpolated by TypeScript.
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
	 * @param task Task with name and command
	 * @returns Absolute path to the generated wrapper script
	 * @throws WrapperGenerationError if generation fails
	 */
	async generate(task: { name: string; command: string }): Promise<string> {
		const wrapperPath = this.getWrapperPath(task.name);
		const logPath = join(this.logsDir, `${task.name}.jsonl`);

		const config: WrapperConfig = {
			taskName: task.name,
			command: task.command,
			logPath,
			maxOutputBytes: MAX_OUTPUT_BYTES,
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
	 * @param tasks Array of tasks with name and command
	 */
	// @spec FR-044: Sync regenerates wrappers — .specs/features/005-wrapper-script-generation/spec.md#fr-044
	async syncWrappers(tasks: { name: string; command: string }[]): Promise<void> {
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
	 * @param config Wrapper configuration
	 * @returns Complete bash script as a string
	 */
	// @spec FR-037: Wrapper script content — .specs/features/005-wrapper-script-generation/spec.md#fr-037
	buildScript(config: WrapperConfig): string {
		const { taskName, command, logPath, maxOutputBytes } = config;
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

		// The rest of the script is static bash — use a raw string block
		// to avoid any TypeScript interpolation issues with bash ${} syntax
		script += WRAPPER_SCRIPT_BODY.replace("{{COMMAND}}", command);

		return script;
	}
}
