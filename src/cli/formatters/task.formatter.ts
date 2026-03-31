// Task-specific formatters: table listing, task details, execution history.
// @spec FR-004: Enriched table columns — .specs/features/006-task-listing-status/spec.md#fr-004
// @spec FR-005: Enriched details — .specs/features/006-task-listing-status/spec.md#fr-005

import type { EnrichedTask } from "../../task/task.types";
import type { ExecutionLogEntry } from "../../log/log.types";
import {
	ANSI_GREEN,
	ANSI_RED,
	ANSI_RESET,
	formatTimestamp,
	formatTimestampWithSeconds,
	truncateOutput,
	formatExitCode,
	formatDuration,
} from "./base.formatter";

/** Maximum characters per stdout/stderr field in history table display. */
const HISTORY_OUTPUT_MAX_CHARS = 80;

/**
 * Format an array of enriched tasks as a CLI table with dynamic column widths.
 * Displays NAME, SCHEDULE, LAST RUN, NEXT RUN, STATUS, TAGS columns.
 * @spec FR-014: Tags column in task table — .specs/features/013-task-groups-tags/spec.md#fr-014
 * @param tasks Array of enriched tasks to display
 * @returns Formatted table string, or "No tasks configured." if empty
 */
export function formatTaskTable(tasks: EnrichedTask[]): string {
	if (tasks.length === 0) {
		return "No tasks configured.";
	}

	const headers = ["NAME", "SCHEDULE", "LAST RUN", "NEXT RUN", "STATUS", "TAGS"];
	const rows = tasks.map((t) => [
		t.name,
		t.schedule,
		t.lastRun ? formatTimestamp(t.lastRun) : "\u2014",
		formatTimestamp(t.nextRun),
		t.status,
		t.tags.length > 0 ? t.tags.join(", ") : "\u2014",
	]);

	const colWidths = headers.map((h, i) =>
		Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length))
	);

	const pad = (str: string, width: number) => str.padEnd(width);
	const headerLine = headers.map((h, i) => pad(h, colWidths[i]!)).join("  ");
	const dataLines = rows.map((row) =>
		row.map((cell, i) => pad(cell ?? "", colWidths[i]!)).join("  ")
	);

	return [headerLine, ...dataLines].join("\n");
}

/**
 * Format a single enriched task with all details for the `get` command.
 * Includes Last run, Exit code (red if non-zero), and Next run fields.
 * @spec FR-005: Enriched details, FR-011: Red exit codes — .specs/features/006-task-listing-status/spec.md#fr-005
 * @param task The enriched task to display
 * @returns Multi-line formatted task details
 */
export function formatTaskDetails(task: EnrichedTask): string {
	// @spec FR-054: Display notify status — .specs/features/008-failure-notifications/spec.md#fr-054
	// @spec FR-013: Display tags in task details — .specs/features/013-task-groups-tags/spec.md#fr-013
	const lines = [
		`Name:       ${task.name}`,
		`ID:         ${task.id}`,
		`Schedule:   ${task.schedule}`,
		`Command:    ${task.command}`,
		`Status:     ${task.status}`,
		`Notify:     ${task.notify ? "on" : "off"}`,
		`Tags:       ${task.tags.length > 0 ? task.tags.join(", ") : "\u2014"}`,
		`Created:    ${task.createdAt}`,
	];
	if (task.updatedAt) {
		lines.push(`Updated:    ${task.updatedAt}`);
	}
	if (task.lastRun) {
		lines.push(`Last run:   ${formatTimestamp(task.lastRun)}`);
		if (task.lastExitCode !== null) {
			const exitCodeStr = task.lastExitCode === 0
				? `${ANSI_GREEN}${task.lastExitCode}${ANSI_RESET}`
				: `${ANSI_RED}${task.lastExitCode}${ANSI_RESET}`;
			lines.push(`Exit code:  ${exitCodeStr}`);
		}
	} else {
		lines.push(`Last run:   \u2014`);
	}
	lines.push(`Next run:   ${formatTimestamp(task.nextRun)}`);
	return lines.join("\n");
}

/**
 * Format execution history entries as a CLI table.
 * @spec FR-004: History table formatting — .specs/features/007-execution-history/spec.md#fr-004
 * @spec FR-005: Output truncation — .specs/features/007-execution-history/spec.md#fr-005
 * @param entries Array of execution log entries (already in display order)
 * @returns Formatted table string
 */
export function formatHistoryTable(entries: ExecutionLogEntry[]): string {
	const headers = ["TIMESTAMP", "EXIT CODE", "DURATION", "STDOUT", "STDERR"];
	const rows = entries.map((e) => [
		formatTimestampWithSeconds(e.timestamp),
		formatExitCode(e.exitCode),
		formatDuration(e.durationMs),
		truncateOutput(e.stdout, HISTORY_OUTPUT_MAX_CHARS),
		truncateOutput(e.stderr, HISTORY_OUTPUT_MAX_CHARS),
	]);

	// Calculate column widths using raw (uncolored) text for alignment
	const rawRows = entries.map((e) => [
		formatTimestampWithSeconds(e.timestamp),
		String(e.exitCode),
		formatDuration(e.durationMs),
		truncateOutput(e.stdout, HISTORY_OUTPUT_MAX_CHARS),
		truncateOutput(e.stderr, HISTORY_OUTPUT_MAX_CHARS),
	]);

	const colWidths = headers.map((h, i) =>
		Math.max(h.length, ...rawRows.map((r) => (r[i] ?? "").length))
	);

	const pad = (str: string, width: number, rawStr?: string) => {
		const rawLen = rawStr !== undefined ? rawStr.length : str.length;
		const padding = Math.max(0, width - rawLen);
		return str + " ".repeat(padding);
	};

	const headerLine = headers.map((h, i) => pad(h, colWidths[i]!)).join("  ");
	const dataLines = rows.map((row, rowIdx) =>
		row.map((cell, colIdx) => pad(cell ?? "", colWidths[colIdx]!, rawRows[rowIdx]![colIdx])).join("  ")
	);

	return [headerLine, ...dataLines].join("\n");
}
