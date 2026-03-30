// @spec FR-001: rotateLogFile — .specs/features/012-log-rotation/spec.md#fr-001
// @spec FR-004: rotateAllLogs — .specs/features/012-log-rotation/spec.md#fr-004
// @spec FR-008: Atomic file rewrite — .specs/features/012-log-rotation/spec.md#fr-008
// @spec FR-009: Default thresholds — .specs/features/012-log-rotation/spec.md#fr-009
// @spec FR-010: Apply max-age first then max-entries — .specs/features/012-log-rotation/spec.md#fr-010

import { rename } from "node:fs/promises";
import { getLogPath } from "../app/config";
import type { Task } from "../task/task.types";
import type { RotationOptions, RotationResult } from "./rotation.types";

/** Default maximum age in days for log entries. */
export const DEFAULT_MAX_AGE_DAYS = 30;

/** Default maximum number of entries to keep per task. */
export const DEFAULT_MAX_ENTRIES = 1000;

/**
 * Parse a JSONL line and extract its timestamp.
 * @param line Raw JSONL line
 * @returns The parsed timestamp as Date and the original line, or null if invalid
 */
function parseLineTimestamp(line: string): { date: Date; line: string } | null {
	try {
		const entry = JSON.parse(line);
		if (typeof entry.timestamp === "string") {
			const date = new Date(entry.timestamp);
			if (!isNaN(date.getTime())) {
				return { date, line };
			}
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * Rotate a single task's log file by removing old entries.
 * Applies max-age filter first, then max-entries cap.
 * Rewrites the file atomically via temp file + rename.
 * @param taskName The task name (for the result)
 * @param logPath Absolute path to the JSONL log file
 * @param options Rotation options
 * @returns Rotation result with before/after counts
 */
export async function rotateLogFile(
	taskName: string,
	logPath: string,
	options: RotationOptions,
): Promise<RotationResult> {
	const file = Bun.file(logPath);
	const exists = await file.exists();

	if (!exists) {
		return { taskName, entriesBefore: 0, entriesAfter: 0, entriesRemoved: 0 };
	}

	const size = file.size;
	if (size === 0) {
		return { taskName, entriesBefore: 0, entriesAfter: 0, entriesRemoved: 0 };
	}

	const content = await file.text();
	const rawLines = content.split("\n").filter((line) => line.trim().length > 0);

	// Parse all lines, dropping corrupted entries
	const parsed = rawLines
		.map(parseLineTimestamp)
		.filter((entry): entry is NonNullable<typeof entry> => entry !== null);

	const entriesBefore = parsed.length;
	const now = options.now ?? new Date();
	const cutoffDate = new Date(now.getTime() - options.maxAgeDays * 24 * 60 * 60 * 1000);

	// Step 1: Filter by max-age (remove entries older than cutoff)
	let filtered = parsed.filter((entry) => entry.date.getTime() >= cutoffDate.getTime());

	// Step 2: Cap by max-entries (keep most recent N)
	if (filtered.length > options.maxEntries) {
		filtered = filtered.slice(filtered.length - options.maxEntries);
	}

	const entriesAfter = filtered.length;
	const entriesRemoved = entriesBefore - entriesAfter;

	// Skip rewrite if nothing changed or dry-run
	if (entriesRemoved === 0 || options.dryRun) {
		return { taskName, entriesBefore, entriesAfter, entriesRemoved };
	}

	// Atomic rewrite: write to temp, then rename
	const tmpPath = `${logPath}.tmp`;
	const newContent = filtered.length > 0
		? filtered.map((entry) => entry.line).join("\n") + "\n"
		: "";

	await Bun.write(tmpPath, newContent);
	await rename(tmpPath, logPath);

	return { taskName, entriesBefore, entriesAfter, entriesRemoved };
}

/**
 * Rotate log files for all provided tasks.
 * @param tasks Array of tasks to rotate
 * @param options Rotation options
 * @returns Array of rotation results (one per task)
 */
export async function rotateAllLogs(
	tasks: Task[],
	options: RotationOptions,
): Promise<RotationResult[]> {
	const results: RotationResult[] = [];

	for (const task of tasks) {
		const logPath = getLogPath(task.name);
		const result = await rotateLogFile(task.name, logPath, options);
		results.push(result);
	}

	return results;
}
