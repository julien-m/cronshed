import { test, expect, describe } from "bun:test";
import { formatTaskTable, formatTaskDetails, formatSuccess, formatError } from "./cli.formatter";
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
		expect(formatSuccess("Task created")).toBe("\u2713 Task created");
	});
});

describe("formatError", () => {
	test("formats error message with X", () => {
		expect(formatError("Something broke")).toBe("\u2717 Error: Something broke");
	});

	test("includes hint when provided", () => {
		const output = formatError("Bad input", "Try again");
		expect(output).toContain("\u2717 Error: Bad input");
		expect(output).toContain("\u2192 Try again");
	});
});
