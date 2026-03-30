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
