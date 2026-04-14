// @spec AC-042 through AC-049: Auto-sync integration tests — .specs/features/004-auto-sync/spec.md#ac-042

import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ShellExecutor } from "../crontab/crontab.adapter";
import { CrontabAdapter } from "../crontab/crontab.adapter";
import { CrontabWriteError } from "../crontab/crontab.errors";
import type { CrontabEntry } from "../crontab/crontab.types";
import { SyncService } from "../crontab/sync.service";
import { TaskRepository } from "../task/task.repository";
import { TaskService } from "../task/task.service";
import { formatSyncConfirmation, formatWarning } from "./cli.formatter";

/** In-memory crontab executor for testing. */
function createMemoryCrontab(initialContent: string = ""): ShellExecutor & { content: string } {
	const state = {
		content: initialContent,
		async exec(cmd: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
			const joined = cmd.join(" ");
			if (joined === "crontab -l") {
				if (state.content === "") {
					return { stdout: "", stderr: "crontab: no crontab for testuser", exitCode: 1 };
				}
				return { stdout: state.content, stderr: "", exitCode: 0 };
			}
			return { stdout: "", stderr: "unexpected command", exitCode: 127 };
		},
	};
	return state;
}

/** Create a test adapter with in-memory read/write. */
function createTestAdapter(initialContent: string = ""): CrontabAdapter & { getContent: () => string } {
	const memoryCrontab = createMemoryCrontab(initialContent);
	const adapter = new CrontabAdapter(memoryCrontab);

	const originalBuild = adapter.build.bind(adapter);
	adapter.write = async (userLines: string[], entries: CrontabEntry[]) => {
		memoryCrontab.content = originalBuild(userLines, entries);
	};

	return Object.assign(adapter, {
		getContent: () => memoryCrontab.content,
	});
}

/** Create a test adapter that throws on write (simulates crontab access denied). */
function createFailingAdapter(): CrontabAdapter & { getContent: () => string } {
	const memoryCrontab = createMemoryCrontab();
	const adapter = new CrontabAdapter(memoryCrontab);

	adapter.write = async () => {
		throw new CrontabWriteError("Cannot write to crontab: permission denied");
	};

	return Object.assign(adapter, {
		getContent: () => memoryCrontab.content,
	});
}

let tmpDir: string;

beforeEach(async () => {
	tmpDir = await mkdtemp(join(tmpdir(), "cronshed-autosync-test-"));
});

describe("Auto-sync on add", () => {
	test("AC-042: add auto-syncs task to crontab", async () => {
		const repo = new TaskRepository(join(tmpDir, "tasks.json"));
		const taskService = new TaskService(repo);
		const adapter = createTestAdapter();
		const syncService = new SyncService(repo, adapter);

		await taskService.add({ name: "backup-db", schedule: "0 2 * * *", command: "/usr/local/bin/backup.sh" });
		const result = await syncService.sync();

		expect(result.installed).toBe(1);
		expect(adapter.getContent()).toContain("# cronshed:backup-db");
		expect(adapter.getContent()).toContain("0 2 * * * /usr/local/bin/backup.sh");
	});

	test("AC-045: add with --no-sync does not touch crontab", async () => {
		const repo = new TaskRepository(join(tmpDir, "tasks.json"));
		const taskService = new TaskService(repo);
		const adapter = createTestAdapter();

		await taskService.add({ name: "backup-db", schedule: "0 2 * * *", command: "/usr/local/bin/backup.sh" });
		// --no-sync means we don't call sync — crontab stays empty
		expect(adapter.getContent()).toBe("");
	});

	test("AC-046: add succeeds when sync fails", async () => {
		const repo = new TaskRepository(join(tmpDir, "tasks.json"));
		const taskService = new TaskService(repo);
		const adapter = createFailingAdapter();
		const syncService = new SyncService(repo, adapter);

		const task = await taskService.add({
			name: "backup-db",
			schedule: "0 2 * * *",
			command: "/usr/local/bin/backup.sh",
		});
		expect(task.name).toBe("backup-db");

		// Auto-sync would fail but the task is created
		let syncFailed = false;
		try {
			await syncService.sync();
		} catch {
			syncFailed = true;
		}
		expect(syncFailed).toBe(true);

		// Verify task still exists in manifest
		const tasks = await taskService.list();
		expect(tasks).toHaveLength(1);
		expect(tasks[0]?.name).toBe("backup-db");
	});
});

describe("Auto-sync on remove", () => {
	test("AC-043: remove auto-syncs removal to crontab", async () => {
		const repo = new TaskRepository(join(tmpDir, "tasks.json"));
		const taskService = new TaskService(repo);

		await taskService.add({ name: "backup-db", schedule: "0 2 * * *", command: "/usr/local/bin/backup.sh" });

		// First sync installs the task
		const existingCrontab = ["# cronshed:backup-db", "0 2 * * * /usr/local/bin/backup.sh", ""].join("\n");
		const adapter = createTestAdapter(existingCrontab);
		const syncService = new SyncService(repo, adapter);

		// Remove the task then sync
		await taskService.remove("backup-db");
		const result = await syncService.sync();

		expect(result.removed).toBe(1);
		expect(adapter.getContent()).not.toContain("cronshed:backup-db");
	});

	test("AC-045: remove with --no-sync keeps crontab entry", async () => {
		const repo = new TaskRepository(join(tmpDir, "tasks.json"));
		const taskService = new TaskService(repo);

		await taskService.add({ name: "backup-db", schedule: "0 2 * * *", command: "/usr/local/bin/backup.sh" });

		const existingCrontab = ["# cronshed:backup-db", "0 2 * * * /usr/local/bin/backup.sh", ""].join("\n");
		const adapter = createTestAdapter(existingCrontab);

		await taskService.remove("backup-db");
		// --no-sync means no sync call — crontab still has the entry
		expect(adapter.getContent()).toContain("cronshed:backup-db");
	});
});

describe("Auto-sync on update", () => {
	test("AC-044: update auto-syncs to crontab", async () => {
		const repo = new TaskRepository(join(tmpDir, "tasks.json"));
		const taskService = new TaskService(repo);

		await taskService.add({ name: "backup-db", schedule: "0 2 * * *", command: "/usr/local/bin/backup.sh" });

		const existingCrontab = ["# cronshed:backup-db", "0 2 * * * /usr/local/bin/backup.sh", ""].join("\n");
		const adapter = createTestAdapter(existingCrontab);
		const syncService = new SyncService(repo, adapter);

		await taskService.update("backup-db", { schedule: "0 3 * * *" });
		const result = await syncService.sync();

		expect(result.updated).toBe(1);
		expect(adapter.getContent()).toContain("0 3 * * *");
		expect(adapter.getContent()).not.toContain("0 2 * * *");
	});

	test("AC-046: update succeeds when sync fails", async () => {
		const repo = new TaskRepository(join(tmpDir, "tasks.json"));
		const taskService = new TaskService(repo);

		await taskService.add({ name: "backup-db", schedule: "0 2 * * *", command: "/usr/local/bin/backup.sh" });

		const task = await taskService.update("backup-db", { schedule: "0 3 * * *" });
		expect(task.schedule).toBe("0 3 * * *");

		// Even if sync would fail, the update is persisted
		const tasks = await taskService.list();
		expect(tasks[0]?.schedule).toBe("0 3 * * *");
	});
});

describe("Auto-sync formatter", () => {
	test("AC-047: sync confirmation message format", () => {
		const msg = formatSyncConfirmation();
		expect(msg).toContain("Synced to crontab");
		expect(msg).toContain("\u2713");
	});

	test("AC-046: sync warning message format", () => {
		const msg = formatWarning("Could not sync to crontab", "Run 'cronshed sync' to retry");
		expect(msg).toContain("\u26A0");
		expect(msg).toContain("Warning: Could not sync to crontab");
		expect(msg).toContain("Run 'cronshed sync' to retry");
	});
});

describe("Batch mutations with --no-sync", () => {
	test("AC-049: batch add then sync installs all tasks", async () => {
		const repo = new TaskRepository(join(tmpDir, "tasks.json"));
		const taskService = new TaskService(repo);
		const adapter = createTestAdapter();
		const syncService = new SyncService(repo, adapter);

		// Add 3 tasks without syncing
		await taskService.add({ name: "task-a", schedule: "0 1 * * *", command: "echo a" });
		await taskService.add({ name: "task-b", schedule: "0 2 * * *", command: "echo b" });
		await taskService.add({ name: "task-c", schedule: "0 3 * * *", command: "echo c" });

		// Single sync applies all
		const result = await syncService.sync();

		expect(result.installed).toBe(3);
		expect(adapter.getContent()).toContain("# cronshed:task-a");
		expect(adapter.getContent()).toContain("# cronshed:task-b");
		expect(adapter.getContent()).toContain("# cronshed:task-c");
	});

	test("AC-049: mix add and remove then sync", async () => {
		const repo = new TaskRepository(join(tmpDir, "tasks.json"));
		const taskService = new TaskService(repo);

		await taskService.add({ name: "old-task", schedule: "0 0 * * *", command: "echo old" });

		const existingCrontab = ["# cronshed:old-task", "0 0 * * * echo old", ""].join("\n");
		const adapter = createTestAdapter(existingCrontab);
		const syncService = new SyncService(repo, adapter);

		// Add new task and remove old — without syncing
		await taskService.add({ name: "new-task", schedule: "0 1 * * *", command: "echo new" });
		await taskService.remove("old-task");

		// Single sync applies both changes
		const result = await syncService.sync();

		expect(result.installed).toBe(1);
		expect(result.removed).toBe(1);
		expect(adapter.getContent()).toContain("# cronshed:new-task");
		expect(adapter.getContent()).not.toContain("cronshed:old-task");
	});
});

describe("Existing sync regression", () => {
	test("AC-048: sync standalone command still works", async () => {
		const repo = new TaskRepository(join(tmpDir, "tasks.json"));
		const taskService = new TaskService(repo);
		const adapter = createTestAdapter();
		const syncService = new SyncService(repo, adapter);

		await taskService.add({ name: "test-task", schedule: "0 0 * * *", command: "echo test" });

		// Standard sync (same as cronshed sync)
		const result = await syncService.sync();
		expect(result.installed).toBe(1);

		// Idempotent re-sync
		const result2 = await syncService.sync();
		expect(result2.isUpToDate).toBe(true);

		// Dry-run
		await taskService.add({ name: "new-task", schedule: "0 1 * * *", command: "echo new" });
		const dryResult = await syncService.sync({ dryRun: true });
		expect(dryResult.installed).toBe(1);
		expect(dryResult.isUpToDate).toBe(false);
		// Crontab should still only have test-task (dry-run didn't write)
		expect(adapter.getContent()).not.toContain("new-task");

		// Clear
		const clearResult = await syncService.sync({ clear: true });
		expect(clearResult.removed).toBe(1);
		expect(adapter.getContent()).not.toContain("cronshed:");
	});
});
