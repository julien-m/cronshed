import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TaskRepository } from "../task/task.repository";
import { TaskService } from "../task/task.service";
import { CrontabAdapter, type ShellExecutor } from "../crontab/crontab.adapter";
import { importCrontabEntries } from "./import.service";
import { formatImportPreview, formatImportSummary, formatSkippedWarning } from "../cli/cli.formatter";

// --- Test helpers ---

function createMockExecutor(crontabContent: string): ShellExecutor {
	return {
		async exec(cmd: string[]) {
			if (cmd[0] === "crontab" && cmd[1] === "-l") {
				return { stdout: crontabContent, stderr: "", exitCode: 0 };
			}
			if (cmd[0] === "crontab" && cmd[1] === "-") {
				return { stdout: "", stderr: "", exitCode: 0 };
			}
			return { stdout: "", stderr: "unknown command", exitCode: 1 };
		},
	};
}

function createEmptyCrontabExecutor(): ShellExecutor {
	return {
		async exec() {
			return { stdout: "", stderr: "crontab: no crontab for user", exitCode: 1 };
		},
	};
}

let tempDir: string;

beforeEach(async () => {
	tempDir = await mkdtemp(join(tmpdir(), "cronshed-import-test-"));
});

afterEach(async () => {
	await rm(tempDir, { recursive: true, force: true });
});

// --- Integration tests ---

describe("import handler integration", () => {
	test("AC-001: full import flow creates tasks from crontab", async () => {
		const crontab = [
			"# User comment",
			"0 * * * * /usr/local/bin/hourly-check.sh",
			"30 2 * * * /opt/scripts/nightly-backup.sh",
			"# cronshed:existing-task",
			"*/5 * * * * /home/user/.cronshed/wrappers/existing-task.sh",
		].join("\n");

		const executor = createMockExecutor(crontab);
		const adapter = new CrontabAdapter(executor);
		const repo = new TaskRepository(join(tempDir, "tasks.json"));
		const taskService = new TaskService(repo);

		// Read crontab and import
		const parsed = await adapter.read();
		const existingNames = new Set<string>();
		const result = importCrontabEntries(parsed.userLines, existingNames, { dryRun: false });

		// Should import 2 entries (skips comment and cronshed-managed)
		expect(result.imported).toHaveLength(2);
		expect(result.imported[0]!.name).toBe("hourly-check");
		expect(result.imported[1]!.name).toBe("nightly-backup");

		// Create tasks
		for (const entry of result.imported) {
			await taskService.add({
				name: entry.name,
				schedule: entry.schedule,
				command: entry.command,
			});
		}

		// Verify tasks in manifest
		const tasks = await taskService.list();
		expect(tasks).toHaveLength(2);
		expect(tasks[0]!.name).toBe("hourly-check");
		expect(tasks[0]!.schedule).toBe("0 * * * *");
		expect(tasks[0]!.command).toBe("/usr/local/bin/hourly-check.sh");
		expect(tasks[0]!.status).toBe("active");
		expect(tasks[0]!.notify).toBe(false);
		expect(tasks[1]!.name).toBe("nightly-backup");
	});

	test("AC-003: imported tasks have active status and notify false", async () => {
		const crontab = "0 * * * * /usr/bin/my-task.sh\n";
		const executor = createMockExecutor(crontab);
		const adapter = new CrontabAdapter(executor);
		const repo = new TaskRepository(join(tempDir, "tasks.json"));
		const taskService = new TaskService(repo);

		const parsed = await adapter.read();
		const result = importCrontabEntries(parsed.userLines, new Set(), { dryRun: false });

		for (const entry of result.imported) {
			await taskService.add({
				name: entry.name,
				schedule: entry.schedule,
				command: entry.command,
			});
		}

		const tasks = await taskService.list();
		expect(tasks[0]!.status).toBe("active");
		expect(tasks[0]!.notify).toBe(false);
	});

	test("AC-005: cronshed-managed entries are not imported", async () => {
		const crontab = [
			"# cronshed:managed-task",
			"*/5 * * * * /home/user/.cronshed/wrappers/managed-task.sh",
			"0 * * * * /usr/bin/user-task.sh",
		].join("\n");

		const executor = createMockExecutor(crontab);
		const adapter = new CrontabAdapter(executor);
		const parsed = await adapter.read();

		// userLines should NOT contain the cronshed marker/cron line
		const result = importCrontabEntries(parsed.userLines, new Set(), { dryRun: false });
		expect(result.imported).toHaveLength(1);
		expect(result.imported[0]!.name).toBe("user-task");
	});

	test("AC-008: resolves name conflicts with existing tasks", async () => {
		const crontab = "0 * * * * /usr/bin/backup.sh\n";
		const executor = createMockExecutor(crontab);
		const adapter = new CrontabAdapter(executor);
		const repo = new TaskRepository(join(tempDir, "tasks.json"));
		const taskService = new TaskService(repo);

		// Pre-create a task named "backup"
		await taskService.add({ name: "backup", schedule: "0 0 * * *", command: "/other/backup.sh" });

		const parsed = await adapter.read();
		const existingTasks = await taskService.list();
		const existingNames = new Set(existingTasks.map((t) => t.name));

		const result = importCrontabEntries(parsed.userLines, existingNames, { dryRun: false });
		expect(result.imported[0]!.name).toBe("backup-2");
	});

	test("AC-010, AC-011: dry-run shows preview without creating tasks", async () => {
		const crontab = [
			"0 * * * * /usr/bin/task-a.sh",
			"30 * * * * /usr/bin/task-b.sh",
		].join("\n");

		const executor = createMockExecutor(crontab);
		const adapter = new CrontabAdapter(executor);
		const repo = new TaskRepository(join(tempDir, "tasks.json"));

		const parsed = await adapter.read();
		const result = importCrontabEntries(parsed.userLines, new Set(), { dryRun: true });

		// Preview should contain entries
		expect(result.imported).toHaveLength(2);
		expect(result.dryRun).toBe(true);

		// Format preview
		const preview = formatImportPreview(result.imported);
		expect(preview).toContain("task-a");
		expect(preview).toContain("task-b");
		expect(preview).toContain("0 * * * *");
		expect(preview).toContain("NAME");
		expect(preview).toContain("SCHEDULE");
		expect(preview).toContain("COMMAND");

		// Summary should say "Would import"
		const summary = formatImportSummary(result);
		expect(summary).toContain("Would import 2 tasks");

		// No tasks should exist
		const tasks = await new TaskService(repo).list();
		expect(tasks).toHaveLength(0);
	});

	test("AC-014: empty crontab shows 'No entries to import'", async () => {
		const executor = createEmptyCrontabExecutor();
		const adapter = new CrontabAdapter(executor);
		const parsed = await adapter.read();

		const result = importCrontabEntries(parsed.userLines, new Set(), { dryRun: false });
		expect(result.imported).toHaveLength(0);

		const summary = formatImportSummary(result);
		expect(summary).toBe("No entries to import");
	});

	test("AC-007: prefix applied to all imported task names", async () => {
		const crontab = [
			"0 * * * * /usr/bin/backup.sh",
			"30 * * * * curl https://example.com/ping",
		].join("\n");

		const executor = createMockExecutor(crontab);
		const adapter = new CrontabAdapter(executor);
		const repo = new TaskRepository(join(tempDir, "tasks.json"));
		const taskService = new TaskService(repo);

		const parsed = await adapter.read();
		const result = importCrontabEntries(parsed.userLines, new Set(), {
			dryRun: false,
			prefix: "old",
		});

		expect(result.imported[0]!.name).toBe("old-backup");
		expect(result.imported[1]!.name).toBe("old-curl");

		// Verify they can be added
		for (const entry of result.imported) {
			await taskService.add({
				name: entry.name,
				schedule: entry.schedule,
				command: entry.command,
			});
		}
		const tasks = await taskService.list();
		expect(tasks).toHaveLength(2);
		expect(tasks[0]!.name).toBe("old-backup");
	});

	test("AC-013: summary shows count of imported tasks", () => {
		const result = {
			imported: [
				{ name: "a", schedule: "0 * * * *", command: "/a", originalLine: "0 * * * * /a" },
				{ name: "b", schedule: "0 * * * *", command: "/b", originalLine: "0 * * * * /b" },
				{ name: "c", schedule: "0 * * * *", command: "/c", originalLine: "0 * * * * /c" },
			],
			skipped: [],
			dryRun: false,
		};

		const summary = formatImportSummary(result);
		expect(summary).toContain("Imported 3 tasks");
	});

	test("AC-013: summary uses singular for 1 task", () => {
		const result = {
			imported: [
				{ name: "a", schedule: "0 * * * *", command: "/a", originalLine: "0 * * * * /a" },
			],
			skipped: [],
			dryRun: false,
		};

		const summary = formatImportSummary(result);
		expect(summary).toContain("Imported 1 task");
	});

	test("skipped entries produce warning format", () => {
		const warning = formatSkippedWarning({ line: "SHELL=/bin/bash", reason: "Environment variable" });
		expect(warning).toContain("Skipped: Environment variable");
		expect(warning).toContain("SHELL=/bin/bash");
	});

	test("AC-004, AC-006: mixed crontab with env vars, comments, and valid entries", async () => {
		const crontab = [
			"SHELL=/bin/bash",
			"MAILTO=admin@example.com",
			"# Daily backup",
			"",
			"0 2 * * * /opt/scripts/backup.sh",
			"# Hourly check",
			"0 * * * * /usr/local/bin/check-status.sh",
		].join("\n");

		const executor = createMockExecutor(crontab);
		const adapter = new CrontabAdapter(executor);
		const parsed = await adapter.read();

		const result = importCrontabEntries(parsed.userLines, new Set(), { dryRun: false });
		expect(result.imported).toHaveLength(2);
		expect(result.imported[0]!.name).toBe("backup");
		expect(result.imported[1]!.name).toBe("check-status");
		// Env vars are in skipped
		expect(result.skipped.filter((s) => s.reason === "Environment variable")).toHaveLength(2);
	});
});
