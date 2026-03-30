// @spec FR-006: JSON output, FR-008: Error formatting — .specs/features/001-task-manifest/spec.md#fr-006
// @spec FR-024: Sync diff display, FR-035: Sync summary — .specs/features/003-crontab-sync/spec.md#fr-024
// @spec FR-070: Diagnosis report formatting — .specs/features/010-task-diagnosis/spec.md#fr-070
// @spec FR-007: Rotation summary formatting — .specs/features/012-log-rotation/spec.md#fr-007

import type { Task, EnrichedTask } from "../task/task.types";
import type { SyncResult, SyncDiffEntry } from "../crontab/sync.service";
import type { ExecutionLogEntry } from "../log/log.types";
import type { DiagnosisResult } from "../diagnosis/diagnosis.types";
import type { ImportResult, ImportedEntry, SkippedEntry } from "../import/import.types";
import type { RotationResult } from "../log/rotation.types";

// ANSI color codes for terminal output (convention: signal/noise maximal, colors for semantic meaning)
// Respects NO_COLOR environment variable per spec: colors disabled only when NO_COLOR is set AND non-empty
// @see https://no-color.org/
const SUPPORTS_COLOR = process.env.NO_COLOR === undefined || process.env.NO_COLOR === "";
const ANSI_GREEN = SUPPORTS_COLOR ? "\x1b[32m" : "";
const ANSI_RED = SUPPORTS_COLOR ? "\x1b[31m" : "";
const ANSI_YELLOW = SUPPORTS_COLOR ? "\x1b[33m" : "";
const ANSI_RESET = SUPPORTS_COLOR ? "\x1b[0m" : "";

/**
 * Format an array of enriched tasks as a CLI table with dynamic column widths.
 * Displays NAME, SCHEDULE, LAST RUN, NEXT RUN, STATUS columns.
 * @spec FR-004: Enriched table columns — .specs/features/006-task-listing-status/spec.md#fr-004
 * @param tasks Array of enriched tasks to display
 * @returns Formatted table string, or "No tasks configured." if empty
 */
// @spec FR-014: Tags column in task table — .specs/features/013-task-groups-tags/spec.md#fr-014
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
 * Format a success message prefixed with ✓ in green.
 * @param message The success message to display
 * @returns Formatted success string with green checkmark prefix
 */
export function formatSuccess(message: string): string {
	return `${ANSI_GREEN}\u2713${ANSI_RESET} ${message}`;
}

/**
 * Format an error message prefixed with ✗ in red, with optional actionable hint.
 * @param message The error message
 * @param hint Optional suggestion line prefixed with →
 */
export function formatError(message: string, hint?: string): string {
	let output = `${ANSI_RED}\u2717${ANSI_RESET} Error: ${message}`;
	if (hint) {
		output += `\n${ANSI_RED}\u2192${ANSI_RESET} ${hint}`;
	}
	return output;
}

/**
 * Format a warning message prefixed with ⚠ in yellow, with optional actionable hint.
 * @param message The warning message
 * @param hint Optional suggestion line prefixed with →
 */
// @spec FR-032: Non-fatal auto-sync warning — .specs/features/004-auto-sync/spec.md#fr-032
export function formatWarning(message: string, hint?: string): string {
	let output = `${ANSI_YELLOW}\u26A0${ANSI_RESET} Warning: ${message}`;
	if (hint) {
		output += `\n${ANSI_YELLOW}\u2192${ANSI_RESET} ${hint}`;
	}
	return output;
}

/**
 * Format the auto-sync confirmation message.
 * @returns Formatted sync confirmation string with checkmark prefix
 */
// @spec FR-033: Sync confirmation message — .specs/features/004-auto-sync/spec.md#fr-033
export function formatSyncConfirmation(): string {
	return formatSuccess("Synced to crontab");
}

/**
 * Format the sync result summary message.
 * @param result The sync result
 * @param isClear Whether --clear was used
 * @returns Formatted summary string
 */
export function formatSyncResult(result: SyncResult, isClear: boolean): string {
	if (isClear) {
		if (result.isUpToDate) {
			return formatSuccess("No cronshed entries to remove");
		}
		return formatSuccess(`Removed ${result.removed} cronshed ${result.removed === 1 ? "entry" : "entries"} from crontab`);
	}

	if (result.isUpToDate) {
		return formatSuccess(`Crontab is up to date (${result.total} ${result.total === 1 ? "task" : "tasks"})`);
	}

	return formatSuccess(
		`Synced ${result.total} ${result.total === 1 ? "task" : "tasks"} to crontab (${result.installed} installed, ${result.updated} updated, ${result.removed} removed)`
	);
}

/**
 * Format an ISO timestamp to a compact local display format (YYYY-MM-DD HH:MM).
 * @param iso ISO 8601 timestamp string
 * @returns Formatted local time string
 */
function formatTimestamp(iso: string): string {
	const date = new Date(iso);
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, "0");
	const d = String(date.getDate()).padStart(2, "0");
	const h = String(date.getHours()).padStart(2, "0");
	const min = String(date.getMinutes()).padStart(2, "0");
	return `${y}-${m}-${d} ${h}:${min}`;
}

/**
 * Format the sync diff for dry-run display.
 * Uses +/~/- prefixes for install/update/remove operations.
 * @param diff Array of diff entries
 * @returns Formatted diff string
 */
export function formatSyncDiff(diff: SyncDiffEntry[]): string {
	const lines: string[] = [];

	for (const entry of diff) {
		switch (entry.type) {
			case "install":
				lines.push(`+ ${entry.taskName}  ${entry.schedule}  ${entry.command}`);
				break;
			case "update": {
				const changes: string[] = [];
				if (entry.oldSchedule !== entry.schedule) {
					changes.push(`${entry.oldSchedule} \u2192 ${entry.schedule}`);
				}
				if (entry.oldCommand !== entry.command) {
					changes.push(`${entry.oldCommand} \u2192 ${entry.command}`);
				}
				lines.push(`~ ${entry.taskName}  ${changes.join(", ")}`);
				break;
			}
			case "remove":
				lines.push(`- ${entry.taskName}  ${entry.schedule}  ${entry.command}`);
				break;
		}
	}

	return lines.join("\n");
}

/** Maximum characters per stdout/stderr field in history table display. */
const HISTORY_OUTPUT_MAX_CHARS = 80;

/**
 * Format a duration in milliseconds to a human-readable string.
 * @param ms Duration in milliseconds
 * @returns Formatted string (e.g., "1.5s", "2m 30s", "0ms")
 */
export function formatDuration(ms: number): string {
	if (ms < 1000) {
		return `${ms}ms`;
	}
	const totalSeconds = Math.floor(ms / 1000);
	if (totalSeconds < 60) {
		const decimal = ms % 1000;
		if (decimal > 0) {
			return `${(ms / 1000).toFixed(1)}s`;
		}
		return `${totalSeconds}s`;
	}
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (seconds === 0) {
		return `${minutes}m`;
	}
	return `${minutes}m ${seconds}s`;
}

/**
 * Truncate a string to maxLen characters, appending "..." if truncated.
 * Replaces newlines with spaces for single-line display.
 * @param str The string to truncate
 * @param maxLen Maximum characters
 * @returns Truncated string
 */
function truncateOutput(str: string, maxLen: number): string {
	const cleaned = str.replace(/[\n\r]/g, " ");
	if (cleaned.length <= maxLen) {
		return cleaned;
	}
	return cleaned.slice(0, maxLen) + "...";
}

/**
 * Format an ISO timestamp to a compact display format with seconds (YYYY-MM-DD HH:MM:SS).
 * @param iso ISO 8601 timestamp string
 * @returns Formatted local time string
 */
function formatTimestampWithSeconds(iso: string): string {
	const date = new Date(iso);
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, "0");
	const d = String(date.getDate()).padStart(2, "0");
	const h = String(date.getHours()).padStart(2, "0");
	const min = String(date.getMinutes()).padStart(2, "0");
	const sec = String(date.getSeconds()).padStart(2, "0");
	return `${y}-${m}-${d} ${h}:${min}:${sec}`;
}

/**
 * Format an exit code with color (green for 0, red for non-zero).
 * @param exitCode The process exit code
 * @returns Colored exit code string
 */
function formatExitCode(exitCode: number): string {
	if (exitCode === 0) {
		return `${ANSI_GREEN}${exitCode}${ANSI_RESET}`;
	}
	return `${ANSI_RED}${exitCode}${ANSI_RESET}`;
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

/**
 * Format diagnosis results as a color-coded report.
 * Green checkmark for healthy tasks, red/yellow for issues with details.
 * @spec FR-070: Diagnosis report formatting — .specs/features/010-task-diagnosis/spec.md#fr-070
 * @param results Array of diagnosis results
 * @returns Formatted report string
 */
export function formatDiagnosisReport(results: DiagnosisResult[]): string {
	const lines: string[] = [];

	for (const result of results) {
		if (result.status === "ok") {
			lines.push(`${ANSI_GREEN}\u2713${ANSI_RESET} ${result.taskName}`);
		} else {
			lines.push(`${ANSI_RED}\u2717${ANSI_RESET} ${result.taskName}`);
			for (const issue of result.issues) {
				const color = issue.severity === "error" ? ANSI_RED : ANSI_YELLOW;
				const prefix = issue.severity === "error" ? "  \u2717" : "  \u26A0";
				lines.push(`${color}${prefix}${ANSI_RESET} ${issue.message}`);
				if (issue.hint) {
					lines.push(`${color}    \u2192${ANSI_RESET} ${issue.hint}`);
				}
			}
		}
	}

	lines.push("");
	lines.push(formatDiagnosisSummary(results));

	return lines.join("\n");
}

/**
 * Format a one-line summary of diagnosis results.
 * @param results Array of diagnosis results
 * @returns Summary string (e.g., "3 tasks checked, 2 ok, 1 with issues")
 */
export function formatDiagnosisSummary(results: DiagnosisResult[]): string {
	const total = results.length;
	const ok = results.filter((r) => r.status === "ok").length;
	const withIssues = total - ok;

	const taskWord = total === 1 ? "task" : "tasks";
	return `${total} ${taskWord} checked, ${ok} ok, ${withIssues} with issues`;
}

// @spec FR-080: Import preview formatting, FR-083: Import summary — .specs/features/011-import-existing-crontab/spec.md#fr-080

/**
 * Format a preview table of entries that would be imported (dry-run output).
 * Shows NAME, SCHEDULE, COMMAND columns with dynamic widths.
 * @param entries Array of entries to preview
 * @returns Formatted table string
 */
export function formatImportPreview(entries: ImportedEntry[]): string {
	const headers = ["NAME", "SCHEDULE", "COMMAND"];
	const rows = entries.map((e) => [e.name, e.schedule, e.command]);

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
 * Format the import summary message.
 * @param result The import result
 * @returns Summary string: "Imported N tasks" or "No entries to import"
 */
export function formatImportSummary(result: ImportResult): string {
	if (result.imported.length === 0) {
		return "No entries to import";
	}

	if (result.dryRun) {
		const taskWord = result.imported.length === 1 ? "task" : "tasks";
		return `Would import ${result.imported.length} ${taskWord}`;
	}

	const taskWord = result.imported.length === 1 ? "task" : "tasks";
	return formatSuccess(`Imported ${result.imported.length} ${taskWord}`);
}

/**
 * Format a warning for a skipped import entry.
 * @param entry The skipped entry
 * @returns Formatted warning string
 */
export function formatSkippedWarning(entry: SkippedEntry): string {
	return formatWarning(`Skipped: ${entry.reason}`, entry.line);
}

// @spec FR-007: Rotation summary formatting — .specs/features/012-log-rotation/spec.md#fr-007

/**
 * Format rotation results as a summary string.
 * Shows per-task stats and a total summary line.
 * @param results Array of rotation results
 * @param dryRun Whether this was a dry-run (prefixes output with "Would remove")
 * @returns Formatted summary string
 */
export function formatRotationSummary(results: RotationResult[], dryRun: boolean): string {
	const withRemovals = results.filter((r) => r.entriesRemoved > 0);

	if (withRemovals.length === 0) {
		return "Nothing to rotate";
	}

	const lines: string[] = [];
	const verb = dryRun ? "Would remove" : "Removed";

	for (const result of withRemovals) {
		const entryWord = result.entriesRemoved === 1 ? "entry" : "entries";
		lines.push(`  ${result.taskName}: ${verb} ${result.entriesRemoved} ${entryWord} (${result.entriesBefore} \u2192 ${result.entriesAfter})`);
	}

	const totalRemoved = withRemovals.reduce((sum, r) => sum + r.entriesRemoved, 0);
	const taskWord = withRemovals.length === 1 ? "task" : "tasks";
	const totalEntryWord = totalRemoved === 1 ? "entry" : "entries";

	if (dryRun) {
		lines.push("");
		lines.push(`Would remove ${totalRemoved} ${totalEntryWord} across ${withRemovals.length} ${taskWord}`);
	} else {
		lines.push("");
		lines.push(formatSuccess(`${verb} ${totalRemoved} ${totalEntryWord} across ${withRemovals.length} ${taskWord}`));
	}

	return lines.join("\n");
}

// @spec FR-006: Run summary formatting — .specs/features/014-dry-run-mode/spec.md#fr-006

/**
 * Format the execution summary line for `cronshed run`.
 * Green checkmark + "completed" for exit 0, red cross + "failed" for non-zero.
 * @param taskName The task name
 * @param exitCode The process exit code
 * @param durationMs Execution duration in milliseconds
 * @returns Formatted summary string
 */
export function formatRunSummary(taskName: string, exitCode: number, durationMs: number): string {
	if (exitCode === 0) {
		return `${ANSI_GREEN}\u2713${ANSI_RESET} ${taskName} completed (exit 0) in ${formatDuration(durationMs)}`;
	}
	return `${ANSI_RED}\u2717${ANSI_RESET} ${taskName} failed (exit ${exitCode}) in ${formatDuration(durationMs)}`;
}

// @spec FR-012: Tags table formatting — .specs/features/013-task-groups-tags/spec.md#fr-012

/**
 * Format a table of tags with their task counts.
 * Sorted alphabetically by tag name.
 * @param tagCounts Map of tag name to task count
 * @returns Formatted table string
 */
export function formatTagsTable(tagCounts: Map<string, number>): string {
	const headers = ["TAG", "TASKS"];
	const sorted = [...tagCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
	const rows = sorted.map(([tag, count]) => [tag, String(count)]);

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
