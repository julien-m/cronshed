// @spec FR-002: Read last execution from logs — .specs/features/006-task-listing-status/spec.md#fr-002
// @spec FR-001: Read execution history — .specs/features/007-execution-history/spec.md#fr-001

import { getLogPath } from "../app/config";
import type { LastExecution, ExecutionLogEntry } from "./log.types";

/** Maximum bytes to read from the end of a log file. */
const TAIL_BYTES = 4096;

/**
 * Get the last execution data for a task by reading its JSONL log file.
 * Reads the last portion of the file and parses the last valid JSON line.
 * @param taskName The task name (used to resolve log file path)
 * @returns The last valid execution entry, or null if no valid entry exists
 */
export async function getLastExecution(taskName: string): Promise<LastExecution | null> {
	const logPath = getLogPath(taskName);
	const file = Bun.file(logPath);

	const exists = await file.exists();
	if (!exists) {
		return null;
	}

	const size = file.size;
	if (size === 0) {
		return null;
	}

	// Read only the tail of the file for performance with large log files
	const offset = Math.max(0, size - TAIL_BYTES);
	const blob = file.slice(offset, size);
	const content = await blob.text();

	const lines = content.split("\n").filter((line) => line.trim().length > 0);

	// Iterate from end to find the last valid JSON line
	for (let i = lines.length - 1; i >= 0; i--) {
		const parsed = tryParseLogEntry(lines[i]!);
		if (parsed !== null) {
			return parsed;
		}
	}

	return null;
}

/**
 * Attempt to parse a single JSONL line into a LastExecution.
 * @param line Raw line from the log file
 * @returns Parsed LastExecution or null if invalid
 */
function tryParseLogEntry(line: string): LastExecution | null {
	try {
		const entry = JSON.parse(line);
		if (
			typeof entry.timestamp === "string" &&
			typeof entry.exitCode === "number" &&
			typeof entry.durationMs === "number"
		) {
			return {
				timestamp: entry.timestamp,
				exitCode: entry.exitCode,
				durationMs: entry.durationMs,
			};
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * Attempt to parse a single JSONL line into a full ExecutionLogEntry.
 * @param line Raw line from the log file
 * @returns Parsed ExecutionLogEntry or null if invalid
 */
function tryParseFullLogEntry(line: string): ExecutionLogEntry | null {
	try {
		const entry = JSON.parse(line);
		if (
			typeof entry.timestamp === "string" &&
			typeof entry.exitCode === "number" &&
			typeof entry.durationMs === "number"
		) {
			return {
				timestamp: entry.timestamp,
				exitCode: entry.exitCode,
				durationMs: entry.durationMs,
				stdout: typeof entry.stdout === "string" ? entry.stdout : "",
				stderr: typeof entry.stderr === "string" ? entry.stderr : "",
			};
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * Get the full execution history for a task by reading its JSONL log file.
 * Parses all valid entries, silently skipping corrupted lines.
 * @param taskName The task name (used to resolve log file path)
 * @returns Array of valid execution entries in file order (oldest first)
 */
// @spec FR-001: Read execution history — .specs/features/007-execution-history/spec.md#fr-001
export async function getExecutionHistory(taskName: string): Promise<ExecutionLogEntry[]> {
	const logPath = getLogPath(taskName);
	const file = Bun.file(logPath);

	const exists = await file.exists();
	if (!exists) {
		return [];
	}

	const size = file.size;
	if (size === 0) {
		return [];
	}

	const content = await file.text();
	const lines = content.split("\n").filter((line) => line.trim().length > 0);
	const entries: ExecutionLogEntry[] = [];

	for (const line of lines) {
		const parsed = tryParseFullLogEntry(line);
		if (parsed !== null) {
			entries.push(parsed);
		}
	}

	return entries;
}
