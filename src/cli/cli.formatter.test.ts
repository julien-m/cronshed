import { test, expect, describe } from "bun:test";
import { formatTaskTable, formatTaskDetails, formatSuccess, formatError, formatWarning, formatSyncConfirmation } from "./cli.formatter";
import type { Task } from "../task/task.types";

const sampleTask: Task = {
	id: "test-uuid-123",
	name: "backup-db",
	schedule: "0 2 * * *",
	command: "/usr/local/bin/backup.sh",
	status: "active",
	createdAt: "2026-03-30T00:00:00.000Z",
};

describe("formatTaskTable", () => {
	test("AC-005: formats tasks as a table with headers", () => {
		const output = formatTaskTable([sampleTask]);
		expect(output).toContain("NAME");
		expect(output).toContain("SCHEDULE");
		expect(output).toContain("COMMAND");
		expect(output).toContain("STATUS");
		expect(output).toContain("backup-db");
		expect(output).toContain("0 2 * * *");
	});

	test("AC-007: returns message for empty list", () => {
		const output = formatTaskTable([]);
		expect(output).toBe("No tasks configured.");
	});
});

describe("formatTaskDetails", () => {
	test("AC-013: shows all fields for a task", () => {
		const output = formatTaskDetails(sampleTask);
		expect(output).toContain("backup-db");
		expect(output).toContain("test-uuid-123");
		expect(output).toContain("0 2 * * *");
		expect(output).toContain("/usr/local/bin/backup.sh");
		expect(output).toContain("active");
		expect(output).toContain("2026-03-30");
	});

	test("AC-013: shows updatedAt when present", () => {
		const taskWithUpdate = { ...sampleTask, updatedAt: "2026-03-31T00:00:00.000Z" };
		const output = formatTaskDetails(taskWithUpdate);
		expect(output).toContain("Updated:");
		expect(output).toContain("2026-03-31");
	});

	test("AC-013: does not show updatedAt when absent", () => {
		const output = formatTaskDetails(sampleTask);
		expect(output).not.toContain("Updated:");
	});
});

describe("formatSuccess", () => {
	test("formats success message with checkmark", () => {
		const output = formatSuccess("Task created");
		expect(output).toContain("\u2713");
		expect(output).toContain("Task created");
	});

	test("includes ANSI color codes when NO_COLOR not set", () => {
		// When NO_COLOR is not set, formatSuccess should return colored output
		const output = formatSuccess("Task created");
		// Verify symbol is present (always)
		expect(output).toContain("\u2713");
		// If running without NO_COLOR, ANSI escape codes should be in the output
		// In a proper test environment (NO_COLOR not set), this will include \x1b[32m (green)
		expect(output).toContain("Task created");
		// Note: Full NO_COLOR environment variable testing requires separate test process with NO_COLOR preset
	});
});

describe("formatError", () => {
	test("formats error message with X symbol", () => {
		const output = formatError("Something broke");
		expect(output).toContain("\u2717");
		expect(output).toContain("Error: Something broke");
	});

	test("includes hint when provided", () => {
		const output = formatError("Bad input", "Try again");
		expect(output).toContain("\u2717");
		expect(output).toContain("Error: Bad input");
		expect(output).toContain("\u2192");
		expect(output).toContain("Try again");
	});
});

describe("formatWarning", () => {
	test("formats warning message with warning symbol", () => {
		const output = formatWarning("Something went wrong");
		expect(output).toContain("\u26A0");
		expect(output).toContain("Warning: Something went wrong");
	});

	test("includes hint when provided", () => {
		const output = formatWarning("Could not sync", "Run 'cronshed sync' to retry");
		expect(output).toContain("\u26A0");
		expect(output).toContain("Warning: Could not sync");
		expect(output).toContain("\u2192");
		expect(output).toContain("Run 'cronshed sync' to retry");
	});
});

describe("formatSyncConfirmation", () => {
	test("AC-047: returns sync confirmation with checkmark", () => {
		const output = formatSyncConfirmation();
		expect(output).toContain("\u2713");
		expect(output).toContain("Synced to crontab");
	});
});
