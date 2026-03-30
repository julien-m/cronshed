import { test, expect, describe, beforeEach } from "bun:test";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";

const CLI = join(import.meta.dir, "../../index.ts");

let tmpDir: string;
let env: Record<string, string>;

beforeEach(async () => {
	tmpDir = await mkdtemp(join(tmpdir(), "cronshed-cli-test-"));
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

describe("cronshed add", () => {
	test("AC-001: creates a task successfully", async () => {
		const { stdout, exitCode } = await run("add", "backup-db", "--schedule", "0 2 * * *", "--command", "echo hi", "--no-sync");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Task backup-db created");
	});

	test("AC-002: rejects invalid cron with exit code 2", async () => {
		const { stderr, exitCode } = await run("add", "bad-cron", "--schedule", "bad", "--command", "echo hi", "--no-sync");
		expect(exitCode).toBe(2);
		expect(stderr).toContain('Invalid cron expression "bad"');
		expect(stderr).toContain("Expected format");
	});

	test("AC-003: rejects duplicate name with exit code 1", async () => {
		await run("add", "my-task", "--schedule", "0 0 * * *", "--command", "echo hi", "--no-sync");
		const { stderr, exitCode } = await run("add", "my-task", "--schedule", "0 1 * * *", "--command", "echo dup", "--no-sync");
		expect(exitCode).toBe(1);
		expect(stderr).toContain('Task "my-task" already exists');
	});

	test("AC-017: rejects missing task name with exit code 2", async () => {
		const { stderr, exitCode } = await run("add");
		expect(exitCode).toBe(2);
		expect(stderr).toContain("Missing task name");
		expect(stderr).toContain("Usage:");
	});
});

describe("cronshed list", () => {
	test("AC-005: displays tasks in a table", async () => {
		await run("add", "task-a", "--schedule", "0 0 * * *", "--command", "echo a", "--no-sync");
		await run("add", "task-b", "--schedule", "0 1 * * *", "--command", "echo b", "--no-sync");

		const { stdout, exitCode } = await run("list");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("task-a");
		expect(stdout).toContain("task-b");
		expect(stdout).toContain("NAME");
	});

	test("AC-006: outputs JSON array", async () => {
		await run("add", "task-a", "--schedule", "0 0 * * *", "--command", "echo a", "--no-sync");
		const { stdout, exitCode } = await run("list", "--json");
		expect(exitCode).toBe(0);
		const parsed = JSON.parse(stdout);
		expect(Array.isArray(parsed)).toBe(true);
		expect(parsed[0].name).toBe("task-a");
	});

	test("AC-007: shows message when no tasks", async () => {
		const { stdout, exitCode } = await run("list");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("No tasks configured");
	});

	test("list --json returns [] when empty", async () => {
		const { stdout, exitCode } = await run("list", "--json");
		expect(exitCode).toBe(0);
		expect(JSON.parse(stdout)).toEqual([]);
	});
});

describe("cronshed get", () => {
	test("AC-013: shows task details", async () => {
		await run("add", "my-task", "--schedule", "0 2 * * *", "--command", "echo hi", "--no-sync");
		const { stdout, exitCode } = await run("get", "my-task");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("my-task");
		expect(stdout).toContain("0 2 * * *");
		expect(stdout).toContain("echo hi");
		expect(stdout).toContain("active");
	});

	test("AC-014: outputs JSON", async () => {
		await run("add", "my-task", "--schedule", "0 2 * * *", "--command", "echo hi", "--no-sync");
		const { stdout, exitCode } = await run("get", "my-task", "--json");
		expect(exitCode).toBe(0);
		const parsed = JSON.parse(stdout);
		expect(parsed.name).toBe("my-task");
	});

	test("throws for non-existent task with exit code 1", async () => {
		const { stderr, exitCode } = await run("get", "ghost");
		expect(exitCode).toBe(1);
		expect(stderr).toContain('Task "ghost" not found');
	});

	test("AC-017: rejects missing name with exit code 2", async () => {
		const { stderr, exitCode } = await run("get");
		expect(exitCode).toBe(2);
		expect(stderr).toContain("Missing task name");
	});
});

describe("cronshed update", () => {
	test("AC-010: updates schedule", async () => {
		await run("add", "my-task", "--schedule", "0 2 * * *", "--command", "echo hi", "--no-sync");
		const { stdout, exitCode } = await run("update", "my-task", "--schedule", "0 3 * * *", "--no-sync");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Task my-task updated");

		const { stdout: details } = await run("get", "my-task");
		expect(details).toContain("0 3 * * *");
		expect(details).toContain("Updated:");
	});

	test("AC-012: rejects no changes with exit code 2", async () => {
		await run("add", "my-task", "--schedule", "0 2 * * *", "--command", "echo hi", "--no-sync");
		const { stderr, exitCode } = await run("update", "my-task");
		expect(exitCode).toBe(2);
		expect(stderr).toContain("No changes specified");
	});

	test("AC-017: rejects missing name with exit code 2", async () => {
		const { stderr, exitCode } = await run("update");
		expect(exitCode).toBe(2);
		expect(stderr).toContain("Missing task name");
	});
});

describe("cronshed remove", () => {
	test("AC-008: removes a task", async () => {
		await run("add", "my-task", "--schedule", "0 2 * * *", "--command", "echo hi", "--no-sync");
		const { stdout, exitCode } = await run("remove", "my-task", "--no-sync");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Task my-task removed");

		const { stdout: listOut } = await run("list");
		expect(listOut).toContain("No tasks configured");
	});

	test("AC-009: rejects non-existent task with exit code 1", async () => {
		const { stderr, exitCode } = await run("remove", "ghost");
		expect(exitCode).toBe(1);
		expect(stderr).toContain('Task "ghost" not found');
	});

	test("AC-017: rejects missing name with exit code 2", async () => {
		const { stderr, exitCode } = await run("remove");
		expect(exitCode).toBe(2);
		expect(stderr).toContain("Missing task name");
	});
});

describe("error handling", () => {
	test("AC-018: corrupted manifest gives exit code 3", async () => {
		await Bun.write(join(tmpDir, "tasks.json"), "not json");
		const { stderr, exitCode } = await run("list");
		expect(exitCode).toBe(3);
		expect(stderr).toContain("corrupted");
	});

	test("unknown command gives exit code 2", async () => {
		const { stderr, exitCode } = await run("bogus");
		expect(exitCode).toBe(2);
		expect(stderr).toContain('Unknown command "bogus"');
	});
});

describe("command path resolution", () => {
	test("AC-021: add with relative script path resolves to absolute", async () => {
		const scriptPath = join(tmpDir, "test-script.sh");
		await Bun.write(scriptPath, "#!/bin/sh\necho hi");
		const { chmod } = await import("node:fs/promises");
		await chmod(scriptPath, 0o755);

		const { stdout, exitCode } = await run("add", "scripted", "--schedule", "0 0 * * *", "--command", scriptPath, "--no-sync");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Task scripted created");
		expect(stdout).toContain(scriptPath);

		// Verify the absolute path is stored
		const { stdout: details } = await run("get", "scripted", "--json");
		const task = JSON.parse(details);
		expect(task.command).toBe(scriptPath);
	});

	test("AC-024: add with non-existent path gives exit code 2", async () => {
		const missing = join(tmpDir, "nonexistent.sh");
		const { stderr, exitCode } = await run("add", "broken", "--schedule", "0 0 * * *", "--command", missing, "--no-sync");
		expect(exitCode).toBe(2);
		expect(stderr).toContain("File not found");
		expect(stderr).toContain("Resolved to:");
	});

	test("AC-025: add with non-executable file gives exit code 2", async () => {
		const scriptPath = join(tmpDir, "no-exec.sh");
		await Bun.write(scriptPath, "#!/bin/sh\necho hi");
		const { chmod } = await import("node:fs/promises");
		await chmod(scriptPath, 0o644);

		const { stderr, exitCode } = await run("add", "bad-exec", "--schedule", "0 0 * * *", "--command", scriptPath, "--no-sync");
		expect(exitCode).toBe(2);
		expect(stderr).toContain("not executable");
		expect(stderr).toContain("chmod +x");
	});

	test("AC-026: add with inline command stores as-is", async () => {
		const { stdout, exitCode } = await run("add", "inline", "--schedule", "0 0 * * *", "--command", "echo hello world", "--no-sync");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Task inline created");

		const { stdout: details } = await run("get", "inline", "--json");
		const task = JSON.parse(details);
		expect(task.command).toBe("echo hello world");
	});

	test("edge case 7: add with directory path gives exit code 2", async () => {
		const dir = join(tmpDir, "a-directory");
		const { mkdir: mkdirFs } = await import("node:fs/promises");
		await mkdirFs(dir);

		const { stderr, exitCode } = await run("add", "dir-cmd", "--schedule", "0 0 * * *", "--command", dir, "--no-sync");
		expect(exitCode).toBe(2);
		expect(stderr).toContain("directory");
	});

	test("AC-029: update --command with relative path resolves", async () => {
		await run("add", "updatable", "--schedule", "0 0 * * *", "--command", "echo initial", "--no-sync");

		const scriptPath = join(tmpDir, "updated-script.sh");
		await Bun.write(scriptPath, "#!/bin/sh\necho updated");
		const { chmod } = await import("node:fs/promises");
		await chmod(scriptPath, 0o755);

		const { stdout, exitCode } = await run("update", "updatable", "--command", scriptPath, "--no-sync");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Task updatable updated");

		const { stdout: details } = await run("get", "updatable", "--json");
		const task = JSON.parse(details);
		expect(task.command).toBe(scriptPath);
	});

	test("AC-025: update --command with non-executable file gives exit code 2", async () => {
		await run("add", "updatable2", "--schedule", "0 0 * * *", "--command", "echo initial", "--no-sync");

		const scriptPath = join(tmpDir, "no-exec-update.sh");
		await Bun.write(scriptPath, "#!/bin/sh\necho hi");
		const { chmod } = await import("node:fs/promises");
		await chmod(scriptPath, 0o644);

		const { stderr, exitCode } = await run("update", "updatable2", "--command", scriptPath, "--no-sync");
		expect(exitCode).toBe(2);
		expect(stderr).toContain("not executable");
	});

	test("AC-029: update --schedule only does not trigger path resolution", async () => {
		await run("add", "sched-only", "--schedule", "0 0 * * *", "--command", "echo hi", "--no-sync");
		const { stdout, exitCode } = await run("update", "sched-only", "--schedule", "0 4 * * *", "--no-sync");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Task sched-only updated");

		const { stdout: details } = await run("get", "sched-only", "--json");
		const task = JSON.parse(details);
		expect(task.schedule).toBe("0 4 * * *");
		expect(task.command).toBe("echo hi");
	});
});

// --- Execution History (Feature 007) ---

async function writeLogEntries(taskName: string, entries: Record<string, unknown>[]): Promise<void> {
	const { mkdir } = await import("node:fs/promises");
	const logsDir = join(tmpDir, "logs");
	await mkdir(logsDir, { recursive: true });
	const lines = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
	await Bun.write(join(logsDir, `${taskName}.jsonl`), lines);
}

function makeHistoryEntry(overrides?: Partial<{ timestamp: string; exitCode: number; durationMs: number; stdout: string; stderr: string }>): Record<string, unknown> {
	return {
		timestamp: "2026-03-30T02:00:05Z",
		exitCode: 0,
		durationMs: 1500,
		stdout: "",
		stderr: "",
		...overrides,
	};
}

describe("cronshed history", () => {
	// @spec AC-001: history displays entries in reverse chronological order
	test("AC-001: displays history entries in reverse chronological order", async () => {
		await run("add", "backup-db", "--schedule", "0 2 * * *", "--command", "echo hi", "--no-sync");
		await writeLogEntries("backup-db", [
			makeHistoryEntry({ timestamp: "2026-03-28T02:00:05Z" }),
			makeHistoryEntry({ timestamp: "2026-03-29T02:00:05Z" }),
			makeHistoryEntry({ timestamp: "2026-03-30T02:00:05Z" }),
		]);

		const { stdout, exitCode } = await run("history", "backup-db");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("TIMESTAMP");
		expect(stdout).toContain("EXIT CODE");
		expect(stdout).toContain("DURATION");
		// Most recent should appear first in output
		const lines = stdout.split("\n").filter((l: string) => l.trim().length > 0);
		expect(lines.length).toBe(4); // header + 3 entries
		expect(lines[1]).toContain("2026-03-30");
		expect(lines[3]).toContain("2026-03-28");
	});

	// @spec AC-004: default limit is 10
	test("AC-004: limits to 10 entries by default", async () => {
		await run("add", "busy-task", "--schedule", "* * * * *", "--command", "echo hi", "--no-sync");
		const entries = Array.from({ length: 15 }, (_, i) =>
			makeHistoryEntry({ timestamp: `2026-03-${String(i + 10).padStart(2, "0")}T02:00:05Z` })
		);
		await writeLogEntries("busy-task", entries);

		const { stdout, exitCode } = await run("history", "busy-task");
		expect(exitCode).toBe(0);
		const lines = stdout.split("\n").filter((l: string) => l.trim().length > 0);
		expect(lines.length).toBe(11); // header + 10 entries
	});

	// @spec AC-005: --limit N restricts output
	test("AC-005: --limit restricts number of entries", async () => {
		await run("add", "backup-db", "--schedule", "0 2 * * *", "--command", "echo hi", "--no-sync");
		await writeLogEntries("backup-db", [
			makeHistoryEntry({ timestamp: "2026-03-28T02:00:05Z" }),
			makeHistoryEntry({ timestamp: "2026-03-29T02:00:05Z" }),
			makeHistoryEntry({ timestamp: "2026-03-30T02:00:05Z" }),
		]);

		const { stdout, exitCode } = await run("history", "backup-db", "--limit", "2");
		expect(exitCode).toBe(0);
		const lines = stdout.split("\n").filter((l: string) => l.trim().length > 0);
		expect(lines.length).toBe(3); // header + 2 entries
	});

	// @spec AC-006: --json outputs valid JSON array
	test("AC-006: --json outputs valid JSON array", async () => {
		await run("add", "backup-db", "--schedule", "0 2 * * *", "--command", "echo hi", "--no-sync");
		await writeLogEntries("backup-db", [
			makeHistoryEntry({ timestamp: "2026-03-28T02:00:05Z", stdout: "ok" }),
			makeHistoryEntry({ timestamp: "2026-03-29T02:00:05Z" }),
		]);

		const { stdout, exitCode } = await run("history", "backup-db", "--json");
		expect(exitCode).toBe(0);
		const parsed = JSON.parse(stdout);
		expect(Array.isArray(parsed)).toBe(true);
		expect(parsed).toHaveLength(2);
		// Most recent first
		expect(parsed[0].timestamp).toBe("2026-03-29T02:00:05Z");
		expect(parsed[1].timestamp).toBe("2026-03-28T02:00:05Z");
		expect(parsed[1].stdout).toBe("ok");
	});

	// @spec AC-007: --json with no history outputs []
	test("AC-007: --json with no history outputs empty array", async () => {
		await run("add", "new-task", "--schedule", "0 2 * * *", "--command", "echo hi", "--no-sync");

		const { stdout, exitCode } = await run("history", "new-task", "--json");
		expect(exitCode).toBe(0);
		expect(JSON.parse(stdout)).toEqual([]);
	});

	// @spec AC-008: non-existent task gives exit code 1
	test("AC-008: non-existent task gives error with exit code 1", async () => {
		const { stderr, exitCode } = await run("history", "ghost-task");
		expect(exitCode).toBe(1);
		expect(stderr).toContain('Task "ghost-task" not found');
	});

	// @spec AC-009: missing name gives exit code 2
	test("AC-009: missing task name gives error with exit code 2", async () => {
		const { stderr, exitCode } = await run("history");
		expect(exitCode).toBe(2);
		expect(stderr).toContain("Missing task name");
		expect(stderr).toContain("Usage:");
	});

	// @spec AC-010: no log file shows message
	test("AC-010: task with no log file shows no-history message", async () => {
		await run("add", "new-task", "--schedule", "0 2 * * *", "--command", "echo hi", "--no-sync");

		const { stdout, exitCode } = await run("history", "new-task");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("No execution history for new-task");
	});

	// @spec AC-012: --json respects --limit
	test("AC-012: --json respects --limit", async () => {
		await run("add", "backup-db", "--schedule", "0 2 * * *", "--command", "echo hi", "--no-sync");
		await writeLogEntries("backup-db", [
			makeHistoryEntry({ timestamp: "2026-03-28T02:00:05Z" }),
			makeHistoryEntry({ timestamp: "2026-03-29T02:00:05Z" }),
			makeHistoryEntry({ timestamp: "2026-03-30T02:00:05Z" }),
		]);

		const { stdout, exitCode } = await run("history", "backup-db", "--json", "--limit", "1");
		expect(exitCode).toBe(0);
		const parsed = JSON.parse(stdout);
		expect(parsed).toHaveLength(1);
		expect(parsed[0].timestamp).toBe("2026-03-30T02:00:05Z");
	});

	// @spec AC-013: history command in help output
	test("AC-013: history command appears in --help output", async () => {
		const { stdout, exitCode } = await run("--help");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("history");
	});

	// @spec AC-011: corrupted lines skipped in integration
	test("AC-011: corrupted log lines are silently skipped", async () => {
		await run("add", "bad-logs", "--schedule", "0 2 * * *", "--command", "echo hi", "--no-sync");
		const { mkdir } = await import("node:fs/promises");
		const logsDir = join(tmpDir, "logs");
		await mkdir(logsDir, { recursive: true });
		const lines = [
			JSON.stringify(makeHistoryEntry({ timestamp: "2026-03-28T02:00:05Z" })),
			"this is not valid json",
			JSON.stringify(makeHistoryEntry({ timestamp: "2026-03-30T02:00:05Z" })),
		].join("\n") + "\n";
		await Bun.write(join(logsDir, "bad-logs.jsonl"), lines);

		const { stdout, exitCode } = await run("history", "bad-logs");
		expect(exitCode).toBe(0);
		const outputLines = stdout.split("\n").filter((l: string) => l.trim().length > 0);
		expect(outputLines.length).toBe(3); // header + 2 valid entries
	});
});

// --- Task Pause/Resume (Feature 009) ---

// @spec FR-058: Pause/resume CLI handlers — .specs/features/009-task-pause-resume/spec.md#fr-058
describe("cronshed pause", () => {
	test("AC-001: pauses an active task", async () => {
		await run("add", "daily-backup", "--schedule", "0 2 * * *", "--command", "echo backup", "--no-sync");
		const { stdout, exitCode } = await run("pause", "daily-backup", "--no-sync");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Task daily-backup paused");
	});

	test("AC-001: paused task persists in manifest", async () => {
		await run("add", "daily-backup", "--schedule", "0 2 * * *", "--command", "echo backup", "--no-sync");
		await run("pause", "daily-backup", "--no-sync");
		const { stdout } = await run("get", "daily-backup", "--json");
		const task = JSON.parse(stdout);
		expect(task.status).toBe("paused");
	});

	test("AC-013: pause sets updatedAt", async () => {
		await run("add", "daily-backup", "--schedule", "0 2 * * *", "--command", "echo backup", "--no-sync");
		await run("pause", "daily-backup", "--no-sync");
		const { stdout } = await run("get", "daily-backup", "--json");
		const task = JSON.parse(stdout);
		expect(task.updatedAt).toBeDefined();
	});

	test("AC-007: pausing non-existent task gives exit code 1", async () => {
		const { stderr, exitCode } = await run("pause", "ghost");
		expect(exitCode).toBe(1);
		expect(stderr).toContain('Task "ghost" not found');
	});

	test("AC-005: pausing already-paused task gives exit code 1", async () => {
		await run("add", "daily-backup", "--schedule", "0 2 * * *", "--command", "echo backup", "--no-sync");
		await run("pause", "daily-backup", "--no-sync");
		const { stderr, exitCode } = await run("pause", "daily-backup", "--no-sync");
		expect(exitCode).toBe(1);
		expect(stderr).toContain('Task "daily-backup" is already paused');
	});

	test("AC-012: pause with --no-sync does not show sync message", async () => {
		await run("add", "daily-backup", "--schedule", "0 2 * * *", "--command", "echo backup", "--no-sync");
		const { stdout } = await run("pause", "daily-backup", "--no-sync");
		expect(stdout).not.toContain("Synced to crontab");
	});

	test("missing task name gives exit code 2", async () => {
		const { stderr, exitCode } = await run("pause");
		expect(exitCode).toBe(2);
		expect(stderr).toContain("Missing task name");
	});
});

// @spec FR-058: Resume CLI handler — .specs/features/009-task-pause-resume/spec.md#fr-058
describe("cronshed resume", () => {
	test("AC-003: resumes a paused task", async () => {
		await run("add", "daily-backup", "--schedule", "0 2 * * *", "--command", "echo backup", "--no-sync");
		await run("pause", "daily-backup", "--no-sync");
		const { stdout, exitCode } = await run("resume", "daily-backup", "--no-sync");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Task daily-backup resumed");
	});

	test("AC-003: resumed task has active status in manifest", async () => {
		await run("add", "daily-backup", "--schedule", "0 2 * * *", "--command", "echo backup", "--no-sync");
		await run("pause", "daily-backup", "--no-sync");
		await run("resume", "daily-backup", "--no-sync");
		const { stdout } = await run("get", "daily-backup", "--json");
		const task = JSON.parse(stdout);
		expect(task.status).toBe("active");
	});

	test("AC-013: resume sets updatedAt", async () => {
		await run("add", "daily-backup", "--schedule", "0 2 * * *", "--command", "echo backup", "--no-sync");
		await run("pause", "daily-backup", "--no-sync");
		await run("resume", "daily-backup", "--no-sync");
		const { stdout } = await run("get", "daily-backup", "--json");
		const task = JSON.parse(stdout);
		expect(task.updatedAt).toBeDefined();
	});

	test("AC-007: resuming non-existent task gives exit code 1", async () => {
		const { stderr, exitCode } = await run("resume", "ghost");
		expect(exitCode).toBe(1);
		expect(stderr).toContain('Task "ghost" not found');
	});

	test("AC-006: resuming already-active task gives exit code 1", async () => {
		await run("add", "daily-backup", "--schedule", "0 2 * * *", "--command", "echo backup", "--no-sync");
		const { stderr, exitCode } = await run("resume", "daily-backup", "--no-sync");
		expect(exitCode).toBe(1);
		expect(stderr).toContain('Task "daily-backup" is already active');
	});

	test("AC-012: resume with --no-sync does not show sync message", async () => {
		await run("add", "daily-backup", "--schedule", "0 2 * * *", "--command", "echo backup", "--no-sync");
		await run("pause", "daily-backup", "--no-sync");
		const { stdout } = await run("resume", "daily-backup", "--no-sync");
		expect(stdout).not.toContain("Synced to crontab");
	});

	test("missing task name gives exit code 2", async () => {
		const { stderr, exitCode } = await run("resume");
		expect(exitCode).toBe(2);
		expect(stderr).toContain("Missing task name");
	});
});

// @spec FR-060: List and get show paused status — .specs/features/009-task-pause-resume/spec.md#fr-060
describe("cronshed list/get with paused tasks", () => {
	test("AC-008: list shows paused status for paused tasks", async () => {
		await run("add", "active-task", "--schedule", "0 2 * * *", "--command", "echo active", "--no-sync");
		await run("add", "paused-task", "--schedule", "0 9 * * 1", "--command", "echo paused", "--no-sync");
		await run("pause", "paused-task", "--no-sync");

		const { stdout, exitCode } = await run("list");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("active-task");
		expect(stdout).toContain("paused-task");
		expect(stdout).toContain("active");
		expect(stdout).toContain("paused");
	});

	test("AC-008: paused task shows dash for next run in list", async () => {
		await run("add", "paused-task", "--schedule", "0 9 * * 1", "--command", "echo paused", "--no-sync");
		await run("pause", "paused-task", "--no-sync");

		const { stdout } = await run("list");
		expect(stdout).toContain("\u2014");
	});

	test("AC-009: list --json includes paused task with correct status", async () => {
		await run("add", "paused-task", "--schedule", "0 9 * * 1", "--command", "echo paused", "--no-sync");
		await run("pause", "paused-task", "--no-sync");

		const { stdout, exitCode } = await run("list", "--json");
		expect(exitCode).toBe(0);
		const parsed = JSON.parse(stdout);
		expect(parsed[0].status).toBe("paused");
		expect(parsed[0].nextRun).toBe("\u2014");
	});

	test("AC-008: get shows paused status and dash for next run", async () => {
		await run("add", "paused-task", "--schedule", "0 9 * * 1", "--command", "echo paused", "--no-sync");
		await run("pause", "paused-task", "--no-sync");

		const { stdout, exitCode } = await run("get", "paused-task");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("paused");
	});

	test("AC-009: get --json on paused task has correct fields", async () => {
		await run("add", "paused-task", "--schedule", "0 9 * * 1", "--command", "echo paused", "--no-sync");
		await run("pause", "paused-task", "--no-sync");

		const { stdout, exitCode } = await run("get", "paused-task", "--json");
		expect(exitCode).toBe(0);
		const task = JSON.parse(stdout);
		expect(task.status).toBe("paused");
		expect(task.nextRun).toBe("\u2014");
	});

	test("pause and resume commands appear in help", async () => {
		const { stdout } = await run("--help");
		expect(stdout).toContain("pause");
		expect(stdout).toContain("resume");
	});
});
