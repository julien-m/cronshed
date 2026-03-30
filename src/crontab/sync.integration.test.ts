import { test, expect, describe, beforeEach } from "bun:test";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { TaskRepository } from "../task/task.repository";
import { TaskService } from "../task/task.service";
import { SyncService } from "./sync.service";
import { CrontabAdapter } from "./crontab.adapter";
import type { ShellExecutor } from "./crontab.adapter";
import type { CrontabEntry } from "./crontab.types";
import { CRONSHED_MARKER_PREFIX } from "./crontab.types";
import { CrontabWriteError } from "./crontab.errors";
import { formatSyncResult, formatSyncDiff } from "../cli/cli.formatter";

/** In-memory crontab executor for integration tests. */
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
			// crontab - (write via stdin) — not directly callable from this executor
			// The adapter uses Bun.spawn for writes, so we override at adapter level
			return { stdout: "", stderr: "unexpected command", exitCode: 127 };
		},
	};
	return state;
}

/** Create a CrontabAdapter with in-memory read/write for testing. */
function createTestAdapter(initialContent: string = ""): CrontabAdapter & { getContent: () => string } {
	const memoryCrontab = createMemoryCrontab(initialContent);
	const adapter = new CrontabAdapter(memoryCrontab);

	// Override write to capture output in memory
	const originalBuild = adapter.build.bind(adapter);
	adapter.write = async (userLines: string[], entries: CrontabEntry[]) => {
		memoryCrontab.content = originalBuild(userLines, entries);
	};

	return Object.assign(adapter, {
		getContent: () => memoryCrontab.content,
	});
}

let tmpDir: string;

beforeEach(async () => {
	tmpDir = await mkdtemp(join(tmpdir(), "cronshed-sync-test-"));
});

describe("Sync integration — full pipeline", () => {
	test("AC-030, AC-035: sync installs tasks and reports counts", async () => {
		const repo = new TaskRepository(join(tmpDir, "tasks.json"));
		const taskService = new TaskService(repo);
		await taskService.add({ name: "backup-db", schedule: "0 2 * * *", command: "/usr/local/bin/backup.sh" });
		await taskService.add({ name: "cleanup-logs", schedule: "0 4 * * 0", command: "find /tmp -name '*.log' -delete" });

		const adapter = createTestAdapter();
		const syncService = new SyncService(repo, adapter);
		const result = await syncService.sync();

		expect(result.installed).toBe(2);
		expect(result.updated).toBe(0);
		expect(result.removed).toBe(0);
		expect(result.total).toBe(2);

		const content = adapter.getContent();
		expect(content).toContain("# cronshed:backup-db");
		expect(content).toContain("0 2 * * * /usr/local/bin/backup.sh");
		expect(content).toContain("# cronshed:cleanup-logs");

		const msg = formatSyncResult(result, false);
		expect(msg).toContain("Synced 2 tasks");
		expect(msg).toContain("2 installed");
	});

	test("AC-034: sync is idempotent", async () => {
		const repo = new TaskRepository(join(tmpDir, "tasks.json"));
		const taskService = new TaskService(repo);
		await taskService.add({ name: "backup-db", schedule: "0 2 * * *", command: "/usr/local/bin/backup.sh" });

		const existingCrontab = [
			"# cronshed:backup-db",
			"0 2 * * * /usr/local/bin/backup.sh",
			"",
		].join("\n");

		const adapter = createTestAdapter(existingCrontab);
		const syncService = new SyncService(repo, adapter);
		const result = await syncService.sync();

		expect(result.isUpToDate).toBe(true);
		const msg = formatSyncResult(result, false);
		expect(msg).toContain("up to date");
	});

	test("AC-033: sync preserves non-cronshed entries", async () => {
		const repo = new TaskRepository(join(tmpDir, "tasks.json"));
		const taskService = new TaskService(repo);
		await taskService.add({ name: "backup-db", schedule: "0 2 * * *", command: "/usr/local/bin/backup.sh" });

		const existingCrontab = "SHELL=/bin/bash\n30 3 * * * /usr/bin/custom-job\n";

		const adapter = createTestAdapter(existingCrontab);
		const syncService = new SyncService(repo, adapter);
		await syncService.sync();

		const content = adapter.getContent();
		const lines = content.split("\n");
		expect(lines[0]).toBe("SHELL=/bin/bash");
		expect(lines[1]).toBe("30 3 * * * /usr/bin/custom-job");
		expect(lines[2]).toBe("");
		expect(lines[3]).toBe("# cronshed:backup-db");
	});

	test("AC-036: dry-run shows diff without writing", async () => {
		const repo = new TaskRepository(join(tmpDir, "tasks.json"));
		const taskService = new TaskService(repo);
		await taskService.add({ name: "backup-db", schedule: "0 2 * * *", command: "/usr/local/bin/backup.sh" });

		const adapter = createTestAdapter();
		const syncService = new SyncService(repo, adapter);
		const result = await syncService.sync({ dryRun: true });

		expect(result.installed).toBe(1);
		expect(result.isUpToDate).toBe(false);
		expect(adapter.getContent()).toBe("");

		const diff = formatSyncDiff(result.diff);
		expect(diff).toContain("+ backup-db");
	});

	test("AC-037: clear removes all cronshed entries", async () => {
		const repo = new TaskRepository(join(tmpDir, "tasks.json"));

		const existingCrontab = [
			"30 3 * * * /usr/bin/custom-job",
			"",
			"# cronshed:task-a",
			"0 1 * * * echo a",
			"# cronshed:task-b",
			"0 2 * * * echo b",
			"",
		].join("\n");

		const adapter = createTestAdapter(existingCrontab);
		const syncService = new SyncService(repo, adapter);
		const result = await syncService.sync({ clear: true });

		expect(result.removed).toBe(2);
		const content = adapter.getContent();
		expect(content).not.toContain("cronshed:");
		expect(content).toContain("30 3 * * * /usr/bin/custom-job");

		const msg = formatSyncResult(result, true);
		expect(msg).toContain("Removed 2");
	});

	test("AC-038: sync with corrupted manifest exits 3", async () => {
		const tasksPath = join(tmpDir, "tasks.json");
		await Bun.write(tasksPath, "not valid json{{{");

		const repo = new TaskRepository(tasksPath);
		const adapter = createTestAdapter();
		const syncService = new SyncService(repo, adapter);

		try {
			await syncService.sync();
			expect(true).toBe(false);
		} catch (err) {
			expect((err as Error).name).toBe("ManifestCorruptedError");
		}
	});

	test("AC-038: dry-run with corrupted manifest throws", async () => {
		const tasksPath = join(tmpDir, "tasks.json");
		await Bun.write(tasksPath, "not valid json{{{");

		const repo = new TaskRepository(tasksPath);
		const adapter = createTestAdapter();
		const syncService = new SyncService(repo, adapter);

		try {
			await syncService.sync({ dryRun: true });
			expect(true).toBe(false);
		} catch (err) {
			expect((err as Error).name).toBe("ManifestCorruptedError");
		}
	});

	test("AC-041: clear with dry-run shows entries without writing", async () => {
		const repo = new TaskRepository(join(tmpDir, "tasks.json"));

		const existingCrontab = [
			"# cronshed:task-a",
			"0 1 * * * echo a",
			"",
		].join("\n");

		const adapter = createTestAdapter(existingCrontab);
		const syncService = new SyncService(repo, adapter);
		const result = await syncService.sync({ clear: true, dryRun: true });

		expect(result.removed).toBe(1);
		expect(result.diff).toHaveLength(1);
		// Content should be unchanged (still the original)
		expect(adapter.getContent()).toContain("cronshed:task-a");

		const diff = formatSyncDiff(result.diff);
		expect(diff).toContain("- task-a");
	});

	test("AC-040: entries are sorted alphabetically", async () => {
		const repo = new TaskRepository(join(tmpDir, "tasks.json"));
		const taskService = new TaskService(repo);
		await taskService.add({ name: "z-task", schedule: "0 1 * * *", command: "echo z" });
		await taskService.add({ name: "a-task", schedule: "0 2 * * *", command: "echo a" });
		await taskService.add({ name: "m-task", schedule: "0 3 * * *", command: "echo m" });

		const adapter = createTestAdapter();
		const syncService = new SyncService(repo, adapter);
		await syncService.sync();

		const content = adapter.getContent();
		const markerIndices = [
			content.indexOf("# cronshed:a-task"),
			content.indexOf("# cronshed:m-task"),
			content.indexOf("# cronshed:z-task"),
		];
		expect(markerIndices[0]).toBeLessThan(markerIndices[1]!);
		expect(markerIndices[1]).toBeLessThan(markerIndices[2]!);
	});
});
