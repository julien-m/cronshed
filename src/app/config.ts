// @spec FR-001: Data directory configuration — .specs/features/001-task-manifest/spec.md#fr-001

import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Get the data directory for cronshed.
 * Respects CRONSHED_HOME environment variable, defaults to ~/.cronshed.
 * @returns Absolute path to data directory
 */
export function getDataDir(): string {
	return process.env["CRONSHED_HOME"] ?? join(homedir(), ".cronshed");
}

/**
 * Get the absolute path to the task manifest file.
 * @returns Absolute path to tasks.json inside the data directory
 */
export function getTasksPath(): string {
	return join(getDataDir(), "tasks.json");
}

/**
 * Get the directory for wrapper scripts.
 * @returns Absolute path to the wrappers directory
 */
// @spec FR-039: Wrapper directory path — .specs/features/005-wrapper-script-generation/spec.md#fr-039
export function getWrappersDir(): string {
	return join(getDataDir(), "wrappers");
}

/**
 * Get the directory for execution logs.
 * @returns Absolute path to the logs directory
 */
// @spec FR-045: Logs directory path — .specs/features/005-wrapper-script-generation/spec.md#fr-045
export function getLogsDir(): string {
	return join(getDataDir(), "logs");
}

/**
 * Get the absolute path to a wrapper script for a given task.
 * @param taskName The task name
 * @returns Absolute path to the wrapper script
 */
// @spec FR-041: Wrapper path for crontab command — .specs/features/005-wrapper-script-generation/spec.md#fr-041
export function getWrapperPath(taskName: string): string {
	return join(getWrappersDir(), `${taskName}.sh`);
}

/**
 * Get the absolute path to the log file for a given task.
 * @param taskName The task name
 * @returns Absolute path to the JSONL log file
 */
export function getLogPath(taskName: string): string {
	return join(getLogsDir(), `${taskName}.jsonl`);
}
