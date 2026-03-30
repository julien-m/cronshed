// @spec FR-006: JSON output, FR-008: Error formatting — .specs/features/001-task-manifest/spec.md#fr-006
// @spec FR-024: Sync diff display, FR-035: Sync summary — .specs/features/003-crontab-sync/spec.md#fr-024

import type { Task, EnrichedTask } from "../task/task.types";
import type { SyncResult, SyncDiffEntry } from "../crontab/sync.service";

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
export function formatTaskTable(tasks: EnrichedTask[]): string {
	if (tasks.length === 0) {
		return "No tasks configured.";
	}

	const headers = ["NAME", "SCHEDULE", "LAST RUN", "NEXT RUN", "STATUS"];
	const rows = tasks.map((t) => [
		t.name,
		t.schedule,
		t.lastRun ? formatTimestamp(t.lastRun) : "\u2014",
		formatTimestamp(t.nextRun),
		t.status,
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
	const lines = [
		`Name:       ${task.name}`,
		`ID:         ${task.id}`,
		`Schedule:   ${task.schedule}`,
		`Command:    ${task.command}`,
		`Status:     ${task.status}`,
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
