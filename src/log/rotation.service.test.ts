import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_MAX_AGE_DAYS, DEFAULT_MAX_ENTRIES, rotateLogFile } from "./rotation.service";
import type { RotationOptions } from "./rotation.types";

let tempDir: string;

beforeEach(async () => {
	tempDir = await mkdtemp(join(tmpdir(), "cronshed-rotation-test-"));
});

afterEach(async () => {
	await rm(tempDir, { recursive: true, force: true });
});

/** Build a JSONL log entry with given timestamp. */
function buildEntry(timestamp: string, exitCode = 0): string {
	return JSON.stringify({
		timestamp,
		exitCode,
		durationMs: 100,
		stdout: "",
		stderr: "",
	});
}

/** Build a date N days ago from the given reference. */
function daysAgo(days: number, now: Date = new Date("2026-03-30T12:00:00Z")): Date {
	return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/** Default options with injectable now. */
function defaultOptions(overrides?: Partial<RotationOptions>): RotationOptions {
	return {
		maxAgeDays: DEFAULT_MAX_AGE_DAYS,
		maxEntries: DEFAULT_MAX_ENTRIES,
		dryRun: false,
		now: new Date("2026-03-30T12:00:00Z"),
		...overrides,
	};
}

describe("rotateLogFile", () => {
	test("AC-001: removes entries older than max-age days", async () => {
		const logPath = join(tempDir, "task.jsonl");
		const lines = [
			buildEntry(daysAgo(60).toISOString()),
			buildEntry(daysAgo(40).toISOString()),
			buildEntry(daysAgo(10).toISOString()),
			buildEntry(daysAgo(5).toISOString()),
		];
		await Bun.write(logPath, `${lines.join("\n")}\n`);

		const result = await rotateLogFile("task", logPath, defaultOptions());

		expect(result.entriesBefore).toBe(4);
		expect(result.entriesAfter).toBe(2);
		expect(result.entriesRemoved).toBe(2);

		// Verify file content
		const content = await Bun.file(logPath).text();
		const remaining = content.trim().split("\n");
		expect(remaining.length).toBe(2);
	});

	test("AC-002: caps entries at max-entries keeping most recent", async () => {
		const logPath = join(tempDir, "task.jsonl");
		// Write entries in chronological order (oldest first, as JSONL files are appended)
		const lines: string[] = [];
		for (let i = 19; i >= 0; i--) {
			lines.push(buildEntry(daysAgo(i).toISOString()));
		}
		await Bun.write(logPath, `${lines.join("\n")}\n`);

		const result = await rotateLogFile("task", logPath, defaultOptions({ maxEntries: 5 }));

		expect(result.entriesBefore).toBe(20);
		expect(result.entriesAfter).toBe(5);
		expect(result.entriesRemoved).toBe(15);

		const content = await Bun.file(logPath).text();
		const remaining = content.trim().split("\n");
		expect(remaining.length).toBe(5);

		// Most recent entries should be preserved (days 0-4, in chronological order)
		const first = JSON.parse(remaining[0]!);
		const last = JSON.parse(remaining[4]!);
		expect(new Date(first.timestamp).getTime()).toBeLessThan(new Date(last.timestamp).getTime());
	});

	test("AC-005: applies max-age first, then max-entries", async () => {
		const logPath = join(tempDir, "task.jsonl");
		const lines: string[] = [];
		// 10 entries older than 30 days, 10 within 30 days
		for (let i = 0; i < 10; i++) {
			lines.push(buildEntry(daysAgo(40 + i).toISOString()));
		}
		for (let i = 0; i < 10; i++) {
			lines.push(buildEntry(daysAgo(i).toISOString()));
		}
		await Bun.write(logPath, `${lines.join("\n")}\n`);

		const result = await rotateLogFile("task", logPath, defaultOptions({ maxEntries: 5 }));

		// Age filter removes 10, then max-entries caps remaining 10 to 5
		expect(result.entriesBefore).toBe(20);
		expect(result.entriesAfter).toBe(5);
		expect(result.entriesRemoved).toBe(15);
	});

	test("AC-003: custom max-age overrides default", async () => {
		const logPath = join(tempDir, "task.jsonl");
		const lines = [
			buildEntry(daysAgo(10).toISOString()),
			buildEntry(daysAgo(5).toISOString()),
			buildEntry(daysAgo(2).toISOString()),
		];
		await Bun.write(logPath, `${lines.join("\n")}\n`);

		const result = await rotateLogFile("task", logPath, defaultOptions({ maxAgeDays: 7 }));

		expect(result.entriesRemoved).toBe(1); // Only the 10-day-old entry
		expect(result.entriesAfter).toBe(2);
	});

	test("AC-004: custom max-entries overrides default", async () => {
		const logPath = join(tempDir, "task.jsonl");
		const lines: string[] = [];
		for (let i = 0; i < 15; i++) {
			lines.push(buildEntry(daysAgo(i).toISOString()));
		}
		await Bun.write(logPath, `${lines.join("\n")}\n`);

		const result = await rotateLogFile("task", logPath, defaultOptions({ maxEntries: 10 }));

		expect(result.entriesAfter).toBe(10);
		expect(result.entriesRemoved).toBe(5);
	});

	test("AC-006: dry-run does not modify files", async () => {
		const logPath = join(tempDir, "task.jsonl");
		const lines = [buildEntry(daysAgo(60).toISOString()), buildEntry(daysAgo(5).toISOString())];
		const originalContent = `${lines.join("\n")}\n`;
		await Bun.write(logPath, originalContent);

		const result = await rotateLogFile("task", logPath, defaultOptions({ dryRun: true }));

		expect(result.entriesRemoved).toBe(1);
		expect(result.entriesAfter).toBe(1);

		// File should be untouched
		const content = await Bun.file(logPath).text();
		expect(content).toBe(originalContent);
	});

	test("AC-012: corrupted log lines are silently dropped during rotation", async () => {
		const logPath = join(tempDir, "task.jsonl");
		const lines = [
			"this is not json",
			buildEntry(daysAgo(5).toISOString()),
			"{ broken json",
			buildEntry(daysAgo(2).toISOString()),
		];
		await Bun.write(logPath, `${lines.join("\n")}\n`);

		const result = await rotateLogFile("task", logPath, defaultOptions());

		// 2 valid entries, 2 corrupted dropped
		expect(result.entriesBefore).toBe(2);
		expect(result.entriesAfter).toBe(2);
		expect(result.entriesRemoved).toBe(0);
	});

	test("AC-014: atomic rewrite via temp file", async () => {
		const logPath = join(tempDir, "task.jsonl");
		const lines = [buildEntry(daysAgo(60).toISOString()), buildEntry(daysAgo(5).toISOString())];
		await Bun.write(logPath, `${lines.join("\n")}\n`);

		await rotateLogFile("task", logPath, defaultOptions());

		// Temp file should not remain
		const tmpExists = await Bun.file(`${logPath}.tmp`).exists();
		expect(tmpExists).toBe(false);

		// Log file should exist with correct content
		const content = await Bun.file(logPath).text();
		const remaining = content.trim().split("\n");
		expect(remaining.length).toBe(1);
	});

	test("returns zero removals when file does not exist", async () => {
		const logPath = join(tempDir, "nonexistent.jsonl");

		const result = await rotateLogFile("task", logPath, defaultOptions());

		expect(result.entriesBefore).toBe(0);
		expect(result.entriesAfter).toBe(0);
		expect(result.entriesRemoved).toBe(0);
	});

	test("returns zero removals when file is empty", async () => {
		const logPath = join(tempDir, "task.jsonl");
		await Bun.write(logPath, "");

		const result = await rotateLogFile("task", logPath, defaultOptions());

		expect(result.entriesBefore).toBe(0);
		expect(result.entriesAfter).toBe(0);
		expect(result.entriesRemoved).toBe(0);
	});

	test("skips rewrite when all entries are within thresholds", async () => {
		const logPath = join(tempDir, "task.jsonl");
		const lines = [buildEntry(daysAgo(5).toISOString()), buildEntry(daysAgo(2).toISOString())];
		const originalContent = `${lines.join("\n")}\n`;
		await Bun.write(logPath, originalContent);

		const result = await rotateLogFile("task", logPath, defaultOptions());

		expect(result.entriesRemoved).toBe(0);
		// File should be unchanged
		const content = await Bun.file(logPath).text();
		expect(content).toBe(originalContent);
	});

	test("empties file when all entries are outside thresholds", async () => {
		const logPath = join(tempDir, "task.jsonl");
		const lines = [buildEntry(daysAgo(60).toISOString()), buildEntry(daysAgo(50).toISOString())];
		await Bun.write(logPath, `${lines.join("\n")}\n`);

		const result = await rotateLogFile("task", logPath, defaultOptions());

		expect(result.entriesRemoved).toBe(2);
		expect(result.entriesAfter).toBe(0);

		const content = await Bun.file(logPath).text();
		expect(content).toBe("");
	});

	test("max-age 0 removes all entries older than now", async () => {
		const logPath = join(tempDir, "task.jsonl");
		const now = new Date("2026-03-30T12:00:00Z");
		const lines = [
			buildEntry(daysAgo(1, now).toISOString()),
			buildEntry(new Date(now.getTime() - 60000).toISOString()), // 1 minute ago
		];
		await Bun.write(logPath, `${lines.join("\n")}\n`);

		const result = await rotateLogFile("task", logPath, defaultOptions({ maxAgeDays: 0, now }));

		// max-age 0 means cutoff = now, so all entries with timestamp < now are removed
		expect(result.entriesRemoved).toBe(2);
		expect(result.entriesAfter).toBe(0);
	});

	test("max-entries 0 removes all entries", async () => {
		const logPath = join(tempDir, "task.jsonl");
		const lines = [buildEntry(daysAgo(1).toISOString()), buildEntry(daysAgo(0).toISOString())];
		await Bun.write(logPath, `${lines.join("\n")}\n`);

		const result = await rotateLogFile("task", logPath, defaultOptions({ maxEntries: 0 }));

		expect(result.entriesRemoved).toBe(2);
		expect(result.entriesAfter).toBe(0);
	});

	test("all corrupted lines are dropped and file is emptied", async () => {
		const logPath = join(tempDir, "task.jsonl");
		const lines = ["not json 1", "not json 2", "{ broken"];
		await Bun.write(logPath, `${lines.join("\n")}\n`);

		const result = await rotateLogFile("task", logPath, defaultOptions());

		expect(result.entriesBefore).toBe(0);
		expect(result.entriesAfter).toBe(0);
		expect(result.entriesRemoved).toBe(0);
	});

	test("preserves entry order after rotation", async () => {
		const logPath = join(tempDir, "task.jsonl");
		const t1 = daysAgo(20).toISOString();
		const t2 = daysAgo(10).toISOString();
		const t3 = daysAgo(5).toISOString();
		const lines = [buildEntry(t1), buildEntry(t2), buildEntry(t3)];
		await Bun.write(logPath, `${lines.join("\n")}\n`);

		await rotateLogFile("task", logPath, defaultOptions());

		const content = await Bun.file(logPath).text();
		const remaining = content.trim().split("\n");
		expect(remaining.length).toBe(3);
		expect(JSON.parse(remaining[0]!).timestamp).toBe(t1);
		expect(JSON.parse(remaining[2]!).timestamp).toBe(t3);
	});
});
