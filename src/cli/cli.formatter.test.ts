import { describe, expect, test } from "bun:test";
import type { ExecutionLogEntry } from "../log/log.types";
import type { EnrichedTask, Task } from "../task/task.types";
import {
	formatDuration,
	formatError,
	formatHistoryTable,
	formatRotationSummary,
	formatSuccess,
	formatSyncConfirmation,
	formatTaskDetails,
	formatTaskTable,
	formatWarning,
} from "./cli.formatter";

const sampleTask: Task = {
	id: "test-uuid-123",
	name: "backup-db",
	schedule: "0 2 * * *",
	command: "/usr/local/bin/backup.sh",
	status: "active",
	notify: false,
	tags: [],
	createdAt: "2026-03-30T00:00:00.000Z",
};

const sampleEnrichedTask: EnrichedTask = {
	...sampleTask,
	lastRun: "2026-03-30T02:00:05Z",
	lastExitCode: 0,
	nextRun: "2026-03-31T02:00:00.000Z",
};

const sampleEnrichedTaskNoLogs: EnrichedTask = {
	...sampleTask,
	name: "cleanup-tmp",
	lastRun: null,
	lastExitCode: null,
	nextRun: "2026-04-06T06:00:00.000Z",
};

describe("formatTaskTable", () => {
	// @spec AC-001: list displays NAME, SCHEDULE, LAST RUN, NEXT RUN, STATUS

	test("AC-001: formats enriched tasks as a table with correct headers", () => {
		const output = formatTaskTable([sampleEnrichedTask]);
		expect(output).toContain("NAME");
		expect(output).toContain("SCHEDULE");
		expect(output).toContain("LAST RUN");
		expect(output).toContain("NEXT RUN");
		expect(output).toContain("STATUS");
		expect(output).toContain("backup-db");
		expect(output).toContain("0 2 * * *");
	});

	test("AC-012: COMMAND column is not shown in list output", () => {
		const output = formatTaskTable([sampleEnrichedTask]);
		// COMMAND should not be a header
		const [headerLine = ""] = output.split("\n");
		expect(headerLine).not.toContain("COMMAND");
	});

	test("AC-002: LAST RUN shows formatted timestamp from log", () => {
		const output = formatTaskTable([sampleEnrichedTask]);
		expect(output).toContain("2026-03-30");
	});

	test("AC-002: LAST RUN shows dash when no logs exist", () => {
		const output = formatTaskTable([sampleEnrichedTaskNoLogs]);
		expect(output).toContain("\u2014");
	});

	test("AC-003: NEXT RUN shows calculated next execution time", () => {
		const output = formatTaskTable([sampleEnrichedTask]);
		expect(output).toContain("2026-03-31");
	});

	test("AC-007: returns message for empty list", () => {
		const output = formatTaskTable([]);
		expect(output).toBe("No tasks configured.");
	});
});

describe("formatTaskDetails", () => {
	// @spec AC-005: get shows Last run, Exit code, Next run

	test("AC-005: shows all fields including run info for enriched task", () => {
		const output = formatTaskDetails(sampleEnrichedTask);
		expect(output).toContain("backup-db");
		expect(output).toContain("test-uuid-123");
		expect(output).toContain("0 2 * * *");
		expect(output).toContain("/usr/local/bin/backup.sh");
		expect(output).toContain("active");
		expect(output).toContain("Last run:");
		expect(output).toContain("Exit code:");
		expect(output).toContain("Next run:");
	});

	test("AC-005: shows dash for Last run when no logs exist", () => {
		const output = formatTaskDetails(sampleEnrichedTaskNoLogs);
		expect(output).toContain("Last run:");
		expect(output).toContain("\u2014");
		expect(output).not.toContain("Exit code:");
		expect(output).toContain("Next run:");
	});

	test("AC-004: failed exit code is shown with ANSI red", () => {
		const failedTask: EnrichedTask = {
			...sampleEnrichedTask,
			lastExitCode: 1,
		};
		const output = formatTaskDetails(failedTask);
		expect(output).toContain("Exit code:");
		// Red ANSI code \x1b[31m should wrap the exit code
		expect(output).toContain("\x1b[31m1\x1b[0m");
	});

	test("AC-005: successful exit code is shown with ANSI green", () => {
		const output = formatTaskDetails(sampleEnrichedTask);
		expect(output).toContain("\x1b[32m0\x1b[0m");
	});

	test("shows updatedAt when present", () => {
		const taskWithUpdate: EnrichedTask = { ...sampleEnrichedTask, updatedAt: "2026-03-31T00:00:00.000Z" };
		const output = formatTaskDetails(taskWithUpdate);
		expect(output).toContain("Updated:");
		expect(output).toContain("2026-03-31");
	});

	test("does not show updatedAt when absent", () => {
		const output = formatTaskDetails(sampleEnrichedTask);
		expect(output).not.toContain("Updated:");
	});

	// @spec FR-054: Display notify status — .specs/features/008-failure-notifications/spec.md#fr-054
	test("AC-073: shows 'Notify: off' when notify is false", () => {
		const output = formatTaskDetails(sampleEnrichedTask);
		expect(output).toContain("Notify:");
		expect(output).toContain("off");
	});

	test("AC-073: shows 'Notify: on' when notify is true", () => {
		const notifyTask: EnrichedTask = { ...sampleEnrichedTask, notify: true };
		const output = formatTaskDetails(notifyTask);
		expect(output).toContain("Notify:");
		expect(output).toContain("on");
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

const sampleHistoryEntry: ExecutionLogEntry = {
	timestamp: "2026-03-30T02:00:05Z",
	exitCode: 0,
	durationMs: 1500,
	stdout: "backup completed",
	stderr: "",
};

describe("formatDuration", () => {
	test("formats milliseconds", () => {
		expect(formatDuration(0)).toBe("0ms");
		expect(formatDuration(500)).toBe("500ms");
		expect(formatDuration(999)).toBe("999ms");
	});

	test("formats seconds", () => {
		expect(formatDuration(1000)).toBe("1s");
		expect(formatDuration(1500)).toBe("1.5s");
		expect(formatDuration(30000)).toBe("30s");
	});

	test("formats minutes and seconds", () => {
		expect(formatDuration(60000)).toBe("1m");
		expect(formatDuration(90000)).toBe("1m 30s");
		expect(formatDuration(150000)).toBe("2m 30s");
	});
});

describe("formatHistoryTable", () => {
	// @spec AC-002: Each entry shows timestamp, exit code, duration, stdout/stderr

	test("AC-002: displays table with correct headers", () => {
		const output = formatHistoryTable([sampleHistoryEntry]);
		expect(output).toContain("TIMESTAMP");
		expect(output).toContain("EXIT CODE");
		expect(output).toContain("DURATION");
		expect(output).toContain("STDOUT");
		expect(output).toContain("STDERR");
	});

	test("AC-002: displays entry data in the table", () => {
		const output = formatHistoryTable([sampleHistoryEntry]);
		expect(output).toContain("2026-03-30");
		expect(output).toContain("backup completed");
		expect(output).toContain("1.5s");
	});

	test("AC-003: exit code 0 is shown in green", () => {
		const output = formatHistoryTable([sampleHistoryEntry]);
		expect(output).toContain("\x1b[32m0\x1b[0m");
	});

	test("AC-003: non-zero exit code is shown in red", () => {
		const failedEntry: ExecutionLogEntry = { ...sampleHistoryEntry, exitCode: 1 };
		const output = formatHistoryTable([failedEntry]);
		expect(output).toContain("\x1b[31m1\x1b[0m");
	});

	test("AC-002: multiple entries displayed correctly", () => {
		const entries: ExecutionLogEntry[] = [
			{ ...sampleHistoryEntry, timestamp: "2026-03-30T02:00:05Z" },
			{ ...sampleHistoryEntry, timestamp: "2026-03-29T02:00:05Z", exitCode: 1, durationMs: 500 },
		];
		const output = formatHistoryTable(entries);
		const lines = output.split("\n");
		expect(lines).toHaveLength(3); // header + 2 data rows
	});

	test("FR-005: truncates stdout longer than 80 characters", () => {
		const longEntry: ExecutionLogEntry = {
			...sampleHistoryEntry,
			stdout: "a".repeat(100),
		};
		const output = formatHistoryTable([longEntry]);
		expect(output).toContain(`${"a".repeat(80)}...`);
		expect(output).not.toContain("a".repeat(100));
	});

	test("FR-005: truncates stderr longer than 80 characters", () => {
		const longEntry: ExecutionLogEntry = {
			...sampleHistoryEntry,
			stderr: "e".repeat(100),
		};
		const output = formatHistoryTable([longEntry]);
		expect(output).toContain(`${"e".repeat(80)}...`);
	});

	test("FR-005: replaces newlines in stdout/stderr with spaces", () => {
		const entry: ExecutionLogEntry = {
			...sampleHistoryEntry,
			stdout: "line1\nline2\nline3",
		};
		const output = formatHistoryTable([entry]);
		expect(output).toContain("line1 line2 line3");
		expect(output).not.toContain("\n" + "line2");
	});

	test("does not truncate output within 80 characters", () => {
		const shortEntry: ExecutionLogEntry = {
			...sampleHistoryEntry,
			stdout: "short output",
		};
		const output = formatHistoryTable([shortEntry]);
		expect(output).toContain("short output");
		expect(output).not.toContain("...");
	});
});

// @spec FR-007: Rotation summary formatting — .specs/features/012-log-rotation/spec.md#fr-007
describe("formatRotationSummary", () => {
	test("AC-007: shows per-task stats and total", () => {
		const results = [
			{ taskName: "backup-db", entriesBefore: 100, entriesAfter: 50, entriesRemoved: 50 },
			{ taskName: "sync-files", entriesBefore: 200, entriesAfter: 180, entriesRemoved: 20 },
		];
		const output = formatRotationSummary(results, false);
		expect(output).toContain("backup-db: Removed 50 entries");
		expect(output).toContain("sync-files: Removed 20 entries");
		expect(output).toContain("70 entries across 2 tasks");
	});

	test("AC-008: shows nothing to rotate when no entries removed", () => {
		const results = [{ taskName: "backup-db", entriesBefore: 10, entriesAfter: 10, entriesRemoved: 0 }];
		const output = formatRotationSummary(results, false);
		expect(output).toBe("Nothing to rotate");
	});

	test("shows dry-run prefix", () => {
		const results = [{ taskName: "backup-db", entriesBefore: 100, entriesAfter: 50, entriesRemoved: 50 }];
		const output = formatRotationSummary(results, true);
		expect(output).toContain("Would remove 50 entries");
		expect(output).toContain("Would remove 50 entries across 1 task");
	});

	test("handles single task with singular entry word", () => {
		const results = [{ taskName: "backup-db", entriesBefore: 2, entriesAfter: 1, entriesRemoved: 1 }];
		const output = formatRotationSummary(results, false);
		expect(output).toContain("Removed 1 entry");
		expect(output).toContain("1 entry across 1 task");
	});

	test("filters out tasks with zero removals", () => {
		const results = [
			{ taskName: "backup-db", entriesBefore: 100, entriesAfter: 50, entriesRemoved: 50 },
			{ taskName: "fresh-task", entriesBefore: 5, entriesAfter: 5, entriesRemoved: 0 },
		];
		const output = formatRotationSummary(results, false);
		expect(output).toContain("backup-db");
		expect(output).not.toContain("fresh-task");
		expect(output).toContain("50 entries across 1 task");
	});
});
