import { test, expect, describe, beforeEach } from "bun:test";
import { join } from "node:path";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";

const CLI = join(import.meta.dir, "../../index.ts");

let tmpDir: string;
let env: Record<string, string>;

beforeEach(async () => {
	tmpDir = await mkdtemp(join(tmpdir(), "cronshed-rotate-test-"));
	env = { ...process.env, CRONSHED_HOME: tmpDir } as Record<string, string>;
});

async function run(...args: string[]) {
	const proc = Bun.spawn(["bun", CLI, ...args], {
		env,
		stdout: "pipe",
		stderr: "pipe",
	});

	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	const exitCode = await proc.exited;

	return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

/** Build a JSONL log entry. */
function buildEntry(timestamp: string, exitCode = 0): string {
	return JSON.stringify({
		timestamp,
		exitCode,
		durationMs: 100,
		stdout: "",
		stderr: "",
	});
}

/** Get a date N days ago. */
function daysAgo(days: number): Date {
	return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/** Create a task and its log file with entries. */
async function setupTaskWithLogs(taskName: string, entries: string[]) {
	// Create task via CLI
	await run("add", taskName, "--schedule", "0 0 * * *", "--command", "echo hi", "--no-sync");

	// Write log entries
	const logsDir = join(tmpDir, "logs");
	await mkdir(logsDir, { recursive: true });
	const logPath = join(logsDir, `${taskName}.jsonl`);
	await Bun.write(logPath, entries.join("\n") + "\n");
}

describe("cronshed rotate", () => {
	test("AC-001: removes entries older than 30 days from all task log files", async () => {
		const entries = [
			buildEntry(daysAgo(60).toISOString()),
			buildEntry(daysAgo(40).toISOString()),
			buildEntry(daysAgo(5).toISOString()),
		];
		await setupTaskWithLogs("backup-db", entries);

		const { stdout, exitCode } = await run("rotate");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("backup-db");
		expect(stdout).toContain("Removed");

		// Verify log file
		const logPath = join(tmpDir, "logs", "backup-db.jsonl");
		const content = await Bun.file(logPath).text();
		const remaining = content.trim().split("\n");
		expect(remaining.length).toBe(1);
	});

	test("AC-003: --max-age overrides default threshold", async () => {
		const entries = [
			buildEntry(daysAgo(10).toISOString()),
			buildEntry(daysAgo(5).toISOString()),
			buildEntry(daysAgo(2).toISOString()),
		];
		await setupTaskWithLogs("backup-db", entries);

		const { stdout, exitCode } = await run("rotate", "--max-age", "7");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Removed");

		const logPath = join(tmpDir, "logs", "backup-db.jsonl");
		const content = await Bun.file(logPath).text();
		const remaining = content.trim().split("\n");
		expect(remaining.length).toBe(2);
	});

	test("AC-004: --max-entries overrides default cap", async () => {
		const entries: string[] = [];
		for (let i = 0; i < 20; i++) {
			entries.push(buildEntry(daysAgo(i).toISOString()));
		}
		await setupTaskWithLogs("backup-db", entries);

		const { stdout, exitCode } = await run("rotate", "--max-entries", "5");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Removed");

		const logPath = join(tmpDir, "logs", "backup-db.jsonl");
		const content = await Bun.file(logPath).text();
		const remaining = content.trim().split("\n");
		expect(remaining.length).toBe(5);
	});

	test("AC-006: --dry-run shows preview without modifying files", async () => {
		const entries = [
			buildEntry(daysAgo(60).toISOString()),
			buildEntry(daysAgo(5).toISOString()),
		];
		await setupTaskWithLogs("backup-db", entries);

		const { stdout, exitCode } = await run("rotate", "--dry-run");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Would remove");

		// Verify file untouched
		const logPath = join(tmpDir, "logs", "backup-db.jsonl");
		const content = await Bun.file(logPath).text();
		const remaining = content.trim().split("\n");
		expect(remaining.length).toBe(2);
	});

	test("AC-008: shows nothing to rotate when no entries exceed thresholds", async () => {
		const entries = [
			buildEntry(daysAgo(5).toISOString()),
			buildEntry(daysAgo(2).toISOString()),
		];
		await setupTaskWithLogs("backup-db", entries);

		const { stdout, exitCode } = await run("rotate");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Nothing to rotate");
	});

	test("AC-009: rotate <name> targets a single task only", async () => {
		const oldEntries = [
			buildEntry(daysAgo(60).toISOString()),
			buildEntry(daysAgo(5).toISOString()),
		];
		await setupTaskWithLogs("task-a", oldEntries);
		await setupTaskWithLogs("task-b", oldEntries);

		const { exitCode } = await run("rotate", "task-a");
		expect(exitCode).toBe(0);

		// task-a should be rotated
		const logA = join(tmpDir, "logs", "task-a.jsonl");
		const contentA = await Bun.file(logA).text();
		expect(contentA.trim().split("\n").length).toBe(1);

		// task-b should be untouched
		const logB = join(tmpDir, "logs", "task-b.jsonl");
		const contentB = await Bun.file(logB).text();
		expect(contentB.trim().split("\n").length).toBe(2);
	});

	test("AC-010: non-existent task name produces error with exit code 1", async () => {
		const { stderr, exitCode } = await run("rotate", "nonexistent");
		expect(exitCode).toBe(1);
		expect(stderr).toContain("not found");
	});

	test("AC-011: --json outputs structured JSON", async () => {
		const entries = [
			buildEntry(daysAgo(60).toISOString()),
			buildEntry(daysAgo(5).toISOString()),
		];
		await setupTaskWithLogs("backup-db", entries);

		const { stdout, exitCode } = await run("rotate", "--json");
		expect(exitCode).toBe(0);

		const parsed = JSON.parse(stdout);
		expect(parsed.tasks).toBeArray();
		expect(parsed.tasks[0].taskName).toBe("backup-db");
		expect(parsed.tasks[0].entriesBefore).toBeNumber();
		expect(parsed.tasks[0].entriesAfter).toBeNumber();
		expect(parsed.tasks[0].entriesRemoved).toBeNumber();
		expect(parsed.totalRemoved).toBeNumber();
	});

	test("AC-013: rotate command is listed in --help output", async () => {
		const { stdout, exitCode } = await run("--help");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("rotate");
	});

	test("rejects non-numeric --max-age with error", async () => {
		await setupTaskWithLogs("backup-db", [buildEntry(daysAgo(5).toISOString())]);

		const { stderr, exitCode } = await run("rotate", "--max-age", "abc");
		expect(exitCode).toBe(2);
		expect(stderr).toContain("Invalid --max-age");
	});

	test("rejects non-numeric --max-entries with error", async () => {
		await setupTaskWithLogs("backup-db", [buildEntry(daysAgo(5).toISOString())]);

		const { stderr, exitCode } = await run("rotate", "--max-entries", "abc");
		expect(exitCode).toBe(2);
		expect(stderr).toContain("Invalid --max-entries");
	});

	test("handles multiple tasks with mixed rotation needs", async () => {
		const oldEntries = [
			buildEntry(daysAgo(60).toISOString()),
			buildEntry(daysAgo(5).toISOString()),
		];
		const freshEntries = [
			buildEntry(daysAgo(5).toISOString()),
		];
		await setupTaskWithLogs("old-task", oldEntries);
		await setupTaskWithLogs("fresh-task", freshEntries);

		const { stdout, exitCode } = await run("rotate");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("old-task");
	});
});
