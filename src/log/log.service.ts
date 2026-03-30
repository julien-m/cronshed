// @spec FR-002: Read last execution from logs — .specs/features/006-task-listing-status/spec.md#fr-002

import { getLogPath } from "../app/config";
import type { LastExecution } from "./log.types";

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
