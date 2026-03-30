// @spec FR-006: JSON output, FR-008: Error formatting — .specs/features/001-task-manifest/spec.md#fr-006

import type { Task } from "../task/task.types";

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

/** Format a success message prefixed with ✓. */
export function formatSuccess(message: string): string {
	return `\u2713 ${message}`;
}

/**
 * Format an error message prefixed with ✗, with optional actionable hint.
 * @param message The error message
 * @param hint Optional suggestion line prefixed with →
 */
export function formatError(message: string, hint?: string): string {
	let output = `\u2717 Error: ${message}`;
	if (hint) {
		output += `\n\u2192 ${hint}`;
	}
	return output;
}
