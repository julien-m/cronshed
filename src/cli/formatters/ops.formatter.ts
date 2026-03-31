// Operational formatters: sync, diagnosis, import, rotation, run, tags.
// @spec FR-024: Sync diff display, FR-035: Sync summary — .specs/features/003-crontab-sync/spec.md#fr-024
// @spec FR-070: Diagnosis report formatting — .specs/features/010-task-diagnosis/spec.md#fr-070
// @spec FR-007: Rotation summary formatting — .specs/features/012-log-rotation/spec.md#fr-007
// @spec FR-006: Run summary formatting — .specs/features/014-dry-run-mode/spec.md#fr-006
// @spec FR-012: Tags table formatting — .specs/features/013-task-groups-tags/spec.md#fr-012
// @spec FR-080: Import preview formatting, FR-083: Import summary — .specs/features/011-import-existing-crontab/spec.md#fr-080

import type { SyncResult, SyncDiffEntry } from "../../crontab/sync.service";
import type { DiagnosisResult } from "../../diagnosis/diagnosis.types";
import type { ImportResult, ImportedEntry, SkippedEntry } from "../../import/import.types";
import type { RotationResult } from "../../log/rotation.types";
import {
	ANSI_GREEN,
	ANSI_RED,
	ANSI_YELLOW,
	ANSI_RESET,
	formatSuccess,
	formatWarning,
	formatDuration,
} from "./base.formatter";

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
			lines.push(`${ANSI_GREEN()}\u2713${ANSI_RESET()} ${result.taskName}`);
		} else {
			lines.push(`${ANSI_RED()}\u2717${ANSI_RESET()} ${result.taskName}`);
			for (const issue of result.issues) {
				const color = issue.severity === "error" ? ANSI_RED() : ANSI_YELLOW();
				const prefix = issue.severity === "error" ? "  \u2717" : "  \u26A0";
				lines.push(`${color}${prefix}${ANSI_RESET()} ${issue.message}`);
				if (issue.hint) {
					lines.push(`${color}    \u2192${ANSI_RESET()} ${issue.hint}`);
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

/**
 * Format the execution summary line for `cronshed run`.
 * Green checkmark + "completed" for exit 0, red cross + "failed" for non-zero.
 * @spec FR-006: Run summary formatting — .specs/features/014-dry-run-mode/spec.md#fr-006
 * @param taskName The task name
 * @param exitCode The process exit code
 * @param durationMs Execution duration in milliseconds
 * @returns Formatted summary string
 */
export function formatRunSummary(taskName: string, exitCode: number, durationMs: number): string {
	if (exitCode === 0) {
		return `${ANSI_GREEN()}\u2713${ANSI_RESET()} ${taskName} completed (exit 0) in ${formatDuration(durationMs)}`;
	}
	return `${ANSI_RED()}\u2717${ANSI_RESET()} ${taskName} failed (exit ${exitCode}) in ${formatDuration(durationMs)}`;
}

/**
 * Format a table of tags with their task counts.
 * Sorted alphabetically by tag name.
 * @spec FR-012: Tags table formatting — .specs/features/013-task-groups-tags/spec.md#fr-012
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
