// @spec FR-006: JSON output, FR-008: Error formatting — .specs/features/001-task-manifest/spec.md#fr-006
// @spec FR-024: Sync diff display, FR-035: Sync summary — .specs/features/003-crontab-sync/spec.md#fr-024

import type { Task } from "../task/task.types";
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
 * Format an array of tasks as a CLI table with dynamic column widths.
 * @param tasks Array of tasks to display
 * @returns Formatted table string, or "No tasks configured." if empty
 */
export function formatTaskTable(tasks: Task[]): string {
	if (tasks.length === 0) {
		return "No tasks configured.";
	}

	const headers = ["NAME", "SCHEDULE", "COMMAND", "STATUS"];
	const rows = tasks.map((t) => [t.name, t.schedule, t.command, t.status]);

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
 * Format a single task with all details for the `get` command.
 * @param task The task to display
 * @returns Multi-line formatted task details
 */
export function formatTaskDetails(task: Task): string {
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
