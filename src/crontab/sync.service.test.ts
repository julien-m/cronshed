import { describe, expect, test } from "bun:test";
import type { TaskRepository } from "../task/task.repository";
import type { Task, TaskManifest } from "../task/task.types";
import type { CrontabAdapter } from "./crontab.adapter";
import type { CrontabEntry, ParsedCrontab } from "./crontab.types";
import { SyncService } from "./sync.service";

function buildTask(overrides?: Partial<Task>): Task {
	return {
		id: crypto.randomUUID(),
		name: "test-task",
		schedule: "0 2 * * *",
		command: "/usr/local/bin/test.sh",
		status: "active",
		notify: false,
		tags: [],
		createdAt: new Date().toISOString(),
		...overrides,
	};
}

function mockRepo(tasks: Task[]): TaskRepository {
	return {
		async load(): Promise<TaskManifest> {
			return { version: 1, tasks };
		},
	} as TaskRepository;
}

function mockAdapter(
	crontab: ParsedCrontab,
): CrontabAdapter & { written: { userLines: string[]; entries: CrontabEntry[] } | null } {
	const mock = {
		written: null as { userLines: string[]; entries: CrontabEntry[] } | null,
		async read(): Promise<ParsedCrontab> {
			return crontab;
		},
		async write(userLines: string[], entries: CrontabEntry[]): Promise<void> {
			mock.written = { userLines, entries };
		},
	} as CrontabAdapter & { written: { userLines: string[]; entries: CrontabEntry[] } | null };
	return mock;
}

describe("SyncService.sync", () => {
	test("AC-030: installs tasks into empty crontab", async () => {
		const task = buildTask({ name: "backup-db" });
		const repo = mockRepo([task]);
		const adapter = mockAdapter({ userLines: [], entries: [] });
		const service = new SyncService(repo, adapter);

		const result = await service.sync();

		expect(result.installed).toBe(1);
		expect(result.updated).toBe(0);
		expect(result.removed).toBe(0);
		expect(result.isUpToDate).toBe(false);
		expect(adapter.written).not.toBeNull();
		expect(adapter.written?.entries[0]?.taskName).toBe("backup-db");
	});

	test("AC-032: updates entry when schedule changes", async () => {
		const task = buildTask({ name: "backup-db", schedule: "0 3 * * *" });
		const repo = mockRepo([task]);
		const adapter = mockAdapter({
			userLines: [],
			entries: [{ taskName: "backup-db", schedule: "0 2 * * *", command: task.command }],
		});
		const service = new SyncService(repo, adapter);

		const result = await service.sync();

		expect(result.updated).toBe(1);
		expect(result.installed).toBe(0);
		expect(result.diff[0]?.type).toBe("update");
		expect(result.diff[0]?.oldSchedule).toBe("0 2 * * *");
		expect(result.diff[0]?.schedule).toBe("0 3 * * *");
	});

	test("AC-032: updates entry when command changes", async () => {
		const task = buildTask({ name: "backup-db", command: "/usr/local/bin/backup-v2.sh" });
		const repo = mockRepo([task]);
		const adapter = mockAdapter({
			userLines: [],
			entries: [{ taskName: "backup-db", schedule: task.schedule, command: "/usr/local/bin/backup.sh" }],
		});
		const service = new SyncService(repo, adapter);

		const result = await service.sync();

		expect(result.updated).toBe(1);
		expect(result.diff[0]?.oldCommand).toBe("/usr/local/bin/backup.sh");
	});

	test("AC-031: removes orphaned cronshed entry", async () => {
		const repo = mockRepo([]);
		const adapter = mockAdapter({
			userLines: [],
			entries: [{ taskName: "old-task", schedule: "0 0 * * *", command: "echo old" }],
		});
		const service = new SyncService(repo, adapter);

		const result = await service.sync();

		expect(result.removed).toBe(1);
		expect(result.diff[0]?.type).toBe("remove");
		expect(adapter.written?.entries).toHaveLength(0);
	});

	test("AC-034: idempotent sync (no changes needed)", async () => {
		const task = buildTask({ name: "backup-db" });
		const repo = mockRepo([task]);
		const adapter = mockAdapter({
			userLines: [],
			entries: [{ taskName: "backup-db", schedule: task.schedule, command: task.command }],
		});
		const service = new SyncService(repo, adapter);

		const result = await service.sync();

		expect(result.isUpToDate).toBe(true);
		expect(result.installed).toBe(0);
		expect(result.updated).toBe(0);
		expect(result.removed).toBe(0);
		expect(adapter.written).toBeNull();
	});

	test("AC-035: reports install/update/remove counts", async () => {
		const task1 = buildTask({ name: "new-task" });
		const task2 = buildTask({ name: "updated-task", schedule: "0 5 * * *" });
		const repo = mockRepo([task1, task2]);
		const adapter = mockAdapter({
			userLines: [],
			entries: [
				{ taskName: "updated-task", schedule: "0 2 * * *", command: task2.command },
				{ taskName: "orphan-task", schedule: "0 0 * * *", command: "echo orphan" },
			],
		});
		const service = new SyncService(repo, adapter);

		const result = await service.sync();

		expect(result.installed).toBe(1);
		expect(result.updated).toBe(1);
		expect(result.removed).toBe(1);
		expect(result.total).toBe(2);
	});

	test("AC-036: dry-run returns diff without writing", async () => {
		const task = buildTask({ name: "backup-db" });
		const repo = mockRepo([task]);
		const adapter = mockAdapter({ userLines: [], entries: [] });
		const service = new SyncService(repo, adapter);

		const result = await service.sync({ dryRun: true });

		expect(result.installed).toBe(1);
		expect(result.isUpToDate).toBe(false);
		expect(adapter.written).toBeNull();
	});

	test("AC-039: missing manifest with stale entries removes them", async () => {
		const repo = mockRepo([]); // Empty manifest (simulates missing file → empty tasks)
		const adapter = mockAdapter({
			userLines: ["30 3 * * * /usr/bin/custom-job"],
			entries: [{ taskName: "stale-task", schedule: "0 0 * * *", command: "echo stale" }],
		});
		const service = new SyncService(repo, adapter);

		const result = await service.sync();

		expect(result.removed).toBe(1);
		expect(adapter.written).not.toBeNull();
		expect(adapter.written?.entries).toHaveLength(0);
		expect(adapter.written?.userLines).toEqual(["30 3 * * * /usr/bin/custom-job"]);
	});

	test("AC-039: missing manifest with clean crontab is no-op", async () => {
		const repo = mockRepo([]);
		const adapter = mockAdapter({ userLines: [], entries: [] });
		const service = new SyncService(repo, adapter);

		const result = await service.sync();

		expect(result.isUpToDate).toBe(true);
		expect(adapter.written).toBeNull();
	});

	test("AC-033: preserves user lines through sync", async () => {
		const task = buildTask({ name: "backup-db" });
		const repo = mockRepo([task]);
		const adapter = mockAdapter({
			userLines: ["SHELL=/bin/bash", "30 3 * * * /usr/bin/custom-job"],
			entries: [],
		});
		const service = new SyncService(repo, adapter);

		await service.sync();

		expect(adapter.written?.userLines).toEqual(["SHELL=/bin/bash", "30 3 * * * /usr/bin/custom-job"]);
	});
});

// @spec FR-059: Sync skips paused tasks — .specs/features/009-task-pause-resume/spec.md#fr-059
describe("SyncService.sync — paused task filtering", () => {
	test("AC-010: paused task is not installed in crontab", async () => {
		const active = buildTask({ name: "active-task" });
		const paused = buildTask({ name: "paused-task", status: "paused" });
		const repo = mockRepo([active, paused]);
		const adapter = mockAdapter({ userLines: [], entries: [] });
		const service = new SyncService(repo, adapter);

		const result = await service.sync();

		expect(result.installed).toBe(1);
		expect(result.total).toBe(1);
		expect(adapter.written?.entries).toHaveLength(1);
		expect(adapter.written?.entries[0]?.taskName).toBe("active-task");
	});

	test("AC-010: only active tasks are installed in crontab", async () => {
		const task1 = buildTask({ name: "task-a" });
		const task2 = buildTask({ name: "task-b", status: "paused" });
		const task3 = buildTask({ name: "task-c" });
		const repo = mockRepo([task1, task2, task3]);
		const adapter = mockAdapter({ userLines: [], entries: [] });
		const service = new SyncService(repo, adapter);

		const result = await service.sync();

		expect(result.installed).toBe(2);
		expect(result.total).toBe(2);
		expect(adapter.written?.entries.map((e: CrontabEntry) => e.taskName)).toEqual(["task-a", "task-c"]);
	});

	test("AC-011: dry-run does not show paused tasks", async () => {
		const paused = buildTask({ name: "paused-only", status: "paused" });
		const repo = mockRepo([paused]);
		const adapter = mockAdapter({ userLines: [], entries: [] });
		const service = new SyncService(repo, adapter);

		const result = await service.sync({ dryRun: true });

		expect(result.isUpToDate).toBe(true);
		expect(result.diff).toHaveLength(0);
	});

	test("AC-010: paused task with existing crontab entry gets removed", async () => {
		const paused = buildTask({ name: "was-active", status: "paused" });
		const repo = mockRepo([paused]);
		const adapter = mockAdapter({
			userLines: [],
			entries: [{ taskName: "was-active", schedule: "0 2 * * *", command: "/usr/local/bin/test.sh" }],
		});
		const service = new SyncService(repo, adapter);

		const result = await service.sync();

		expect(result.removed).toBe(1);
		expect(adapter.written?.entries).toHaveLength(0);
	});

	test("all paused tasks are excluded from sync", async () => {
		const paused1 = buildTask({ name: "paused-a", status: "paused" });
		const paused2 = buildTask({ name: "paused-b", status: "paused" });
		const repo = mockRepo([paused1, paused2]);
		const adapter = mockAdapter({ userLines: [], entries: [] });
		const service = new SyncService(repo, adapter);

		const result = await service.sync();

		expect(result.isUpToDate).toBe(true);
		expect(result.total).toBe(0);
	});
});

describe("SyncService.sync --clear", () => {
	test("AC-037: removes all cronshed entries", async () => {
		const repo = mockRepo([]);
		const adapter = mockAdapter({
			userLines: ["30 3 * * * /usr/bin/custom-job"],
			entries: [
				{ taskName: "task-a", schedule: "0 1 * * *", command: "echo a" },
				{ taskName: "task-b", schedule: "0 2 * * *", command: "echo b" },
			],
		});
		const service = new SyncService(repo, adapter);

		const result = await service.sync({ clear: true });

		expect(result.removed).toBe(2);
		expect(adapter.written?.entries).toHaveLength(0);
		expect(adapter.written?.userLines).toEqual(["30 3 * * * /usr/bin/custom-job"]);
	});

	test("AC-037: no-op when no cronshed entries exist", async () => {
		const repo = mockRepo([]);
		const adapter = mockAdapter({ userLines: ["30 3 * * * /usr/bin/custom-job"], entries: [] });
		const service = new SyncService(repo, adapter);

		const result = await service.sync({ clear: true });

		expect(result.isUpToDate).toBe(true);
		expect(result.removed).toBe(0);
		expect(adapter.written).toBeNull();
	});

	test("AC-041: clear with dry-run shows entries without writing", async () => {
		const repo = mockRepo([]);
		const adapter = mockAdapter({
			userLines: [],
			entries: [{ taskName: "task-a", schedule: "0 1 * * *", command: "echo a" }],
		});
		const service = new SyncService(repo, adapter);

		const result = await service.sync({ clear: true, dryRun: true });

		expect(result.removed).toBe(1);
		expect(result.diff).toHaveLength(1);
		expect(result.diff[0]?.type).toBe("remove");
		expect(adapter.written).toBeNull();
	});
});
