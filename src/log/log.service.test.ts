import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getExecutionHistory, getLastExecution } from "./log.service";

let tempDir: string;
const originalEnv = process.env.CRONSHED_HOME;

beforeEach(async () => {
	tempDir = await mkdtemp(join(tmpdir(), "cronshed-log-test-"));
	process.env.CRONSHED_HOME = tempDir;
});

afterEach(async () => {
	if (originalEnv === undefined) {
		delete process.env.CRONSHED_HOME;
	} else {
		process.env.CRONSHED_HOME = originalEnv;
	}
	await rm(tempDir, { recursive: true, force: true });
});

async function writeLogFile(taskName: string, lines: string[]): Promise<void> {
	const logsDir = join(tempDir, "logs");
	const { mkdir } = await import("node:fs/promises");
	await mkdir(logsDir, { recursive: true });
	const logPath = join(logsDir, `${taskName}.jsonl`);
	await Bun.write(logPath, `${lines.join("\n")}\n`);
}

function makeLogEntry(
	overrides?: Partial<{ timestamp: string; exitCode: number; durationMs: number; stdout: string; stderr: string }>,
): string {
	return JSON.stringify({
		timestamp: "2026-03-30T02:00:05Z",
		exitCode: 0,
		durationMs: 1500,
		stdout: "",
		stderr: "",
		...overrides,
	});
}

describe("getLastExecution", () => {
	// @spec AC-009: getLastExecution reads the last valid JSONL entry

	test("AC-009: returns last entry from log file with multiple entries", async () => {
		await writeLogFile("backup-db", [
			makeLogEntry({ timestamp: "2026-03-28T02:00:05Z", exitCode: 0, durationMs: 1000 }),
			makeLogEntry({ timestamp: "2026-03-29T02:00:05Z", exitCode: 0, durationMs: 1200 }),
			makeLogEntry({ timestamp: "2026-03-30T02:00:05Z", exitCode: 0, durationMs: 1500 }),
		]);

		const result = await getLastExecution("backup-db");

		expect(result).not.toBeNull();
		expect(result?.timestamp).toBe("2026-03-30T02:00:05Z");
		expect(result?.exitCode).toBe(0);
		expect(result?.durationMs).toBe(1500);
	});

	test("AC-009: returns entry with non-zero exit code", async () => {
		await writeLogFile("sync-files", [
			makeLogEntry({ timestamp: "2026-03-30T10:00:00Z", exitCode: 1, durationMs: 500 }),
		]);

		const result = await getLastExecution("sync-files");

		expect(result).not.toBeNull();
		expect(result?.exitCode).toBe(1);
	});

	// @spec AC-010: returns null when log file does not exist or is empty

	test("AC-010: returns null when log file does not exist", async () => {
		const result = await getLastExecution("nonexistent-task");
		expect(result).toBeNull();
	});

	test("AC-010: returns null when log file is empty", async () => {
		const logsDir = join(tempDir, "logs");
		const { mkdir } = await import("node:fs/promises");
		await mkdir(logsDir, { recursive: true });
		await Bun.write(join(logsDir, "empty-task.jsonl"), "");

		const result = await getLastExecution("empty-task");
		expect(result).toBeNull();
	});

	// @spec AC-011: handles corrupted last lines gracefully

	test("AC-011: skips corrupted last line and returns previous valid entry", async () => {
		await writeLogFile("bad-task", [
			makeLogEntry({ timestamp: "2026-03-29T02:00:05Z", exitCode: 0, durationMs: 1000 }),
			"this is not valid json",
		]);

		const result = await getLastExecution("bad-task");

		expect(result).not.toBeNull();
		expect(result?.timestamp).toBe("2026-03-29T02:00:05Z");
	});

	test("AC-011: returns null when all lines are corrupted", async () => {
		await writeLogFile("all-bad", ["not json at all", "also not json", "{invalid json too"]);

		const result = await getLastExecution("all-bad");
		expect(result).toBeNull();
	});

	test("AC-011: handles JSON with missing required fields", async () => {
		await writeLogFile("partial-fields", [
			makeLogEntry({ timestamp: "2026-03-28T02:00:05Z", exitCode: 0, durationMs: 1000 }),
			JSON.stringify({ timestamp: "2026-03-30T02:00:05Z" }), // missing exitCode and durationMs
		]);

		const result = await getLastExecution("partial-fields");

		expect(result).not.toBeNull();
		expect(result?.timestamp).toBe("2026-03-28T02:00:05Z");
	});
});

describe("getExecutionHistory", () => {
	// @spec AC-001: Returns entries from log file
	// @spec AC-011: Corrupted lines silently skipped

	test("AC-001: returns all valid entries from log file", async () => {
		await writeLogFile("backup-db", [
			makeLogEntry({ timestamp: "2026-03-28T02:00:05Z", exitCode: 0, durationMs: 1000 }),
			makeLogEntry({ timestamp: "2026-03-29T02:00:05Z", exitCode: 0, durationMs: 1200 }),
			makeLogEntry({ timestamp: "2026-03-30T02:00:05Z", exitCode: 1, durationMs: 500 }),
		]);

		const result = await getExecutionHistory("backup-db");

		expect(result).toHaveLength(3);
		expect(result[0]?.timestamp).toBe("2026-03-28T02:00:05Z");
		expect(result[1]?.timestamp).toBe("2026-03-29T02:00:05Z");
		expect(result[2]?.timestamp).toBe("2026-03-30T02:00:05Z");
		expect(result[2]?.exitCode).toBe(1);
		expect(result[2]?.durationMs).toBe(500);
	});

	test("AC-001: entries include stdout and stderr fields", async () => {
		await writeLogFile("backup-db", [
			makeLogEntry({ timestamp: "2026-03-30T02:00:05Z", exitCode: 0, durationMs: 1500, stdout: "ok", stderr: "" }),
		]);

		const result = await getExecutionHistory("backup-db");

		expect(result).toHaveLength(1);
		expect(result[0]?.stdout).toBe("ok");
		expect(result[0]?.stderr).toBe("");
	});

	test("AC-010: returns empty array when log file does not exist", async () => {
		const result = await getExecutionHistory("nonexistent-task");
		expect(result).toEqual([]);
	});

	test("AC-010: returns empty array when log file is empty", async () => {
		const logsDir = join(tempDir, "logs");
		const { mkdir } = await import("node:fs/promises");
		await mkdir(logsDir, { recursive: true });
		await Bun.write(join(logsDir, "empty-task.jsonl"), "");

		const result = await getExecutionHistory("empty-task");
		expect(result).toEqual([]);
	});

	test("AC-011: skips corrupted lines and returns valid entries", async () => {
		await writeLogFile("mixed-task", [
			makeLogEntry({ timestamp: "2026-03-28T02:00:05Z", exitCode: 0, durationMs: 1000 }),
			"this is not valid json",
			makeLogEntry({ timestamp: "2026-03-30T02:00:05Z", exitCode: 0, durationMs: 1500 }),
		]);

		const result = await getExecutionHistory("mixed-task");

		expect(result).toHaveLength(2);
		expect(result[0]?.timestamp).toBe("2026-03-28T02:00:05Z");
		expect(result[1]?.timestamp).toBe("2026-03-30T02:00:05Z");
	});

	test("AC-011: returns empty array when all lines are corrupted", async () => {
		await writeLogFile("all-bad", ["not json at all", "also not json", "{invalid json too"]);

		const result = await getExecutionHistory("all-bad");
		expect(result).toEqual([]);
	});

	test("AC-011: handles entries with missing stdout/stderr gracefully", async () => {
		await writeLogFile("no-output", [
			JSON.stringify({ timestamp: "2026-03-30T02:00:05Z", exitCode: 0, durationMs: 1000 }),
		]);

		const result = await getExecutionHistory("no-output");

		expect(result).toHaveLength(1);
		expect(result[0]?.stdout).toBe("");
		expect(result[0]?.stderr).toBe("");
	});
});
