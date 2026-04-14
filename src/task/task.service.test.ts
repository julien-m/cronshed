import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InvalidCronExpressionError } from "../cron/cron.errors";
import {
	DuplicateTaskNameError,
	EmptyCommandError,
	InvalidTagError,
	InvalidTaskNameError,
	TaskAlreadyActiveError,
	TaskAlreadyPausedError,
	TaskNotFoundError,
} from "./task.errors";
import { TaskRepository } from "./task.repository";
import { TaskService } from "./task.service";

let tmpDir: string;
let service: TaskService;

beforeEach(async () => {
	tmpDir = await mkdtemp(join(tmpdir(), "cronshed-test-"));
	const repo = new TaskRepository(join(tmpDir, "tasks.json"));
	service = new TaskService(repo);
});

afterEach(async () => {
	// tmpDir will be cleaned up by OS
});

describe("TaskService.add", () => {
	test("AC-001: creates a task with all required fields", async () => {
		const task = await service.add({
			name: "backup-db",
			schedule: "0 2 * * *",
			command: "/usr/local/bin/backup.sh",
		});

		expect(task.id).toBeDefined();
		expect(task.name).toBe("backup-db");
		expect(task.schedule).toBe("0 2 * * *");
		expect(task.command).toBe("/usr/local/bin/backup.sh");
		expect(task.status).toBe("active");
		expect(task.createdAt).toBeDefined();
	});

	test("AC-003: rejects duplicate task names", async () => {
		await service.add({ name: "my-task", schedule: "0 0 * * *", command: "echo hi" });
		await expect(service.add({ name: "my-task", schedule: "0 1 * * *", command: "echo dup" })).rejects.toThrow(
			DuplicateTaskNameError,
		);
	});

	test("AC-002: rejects invalid cron expressions", async () => {
		await expect(service.add({ name: "bad-cron", schedule: "bad", command: "echo hi" })).rejects.toThrow(
			InvalidCronExpressionError,
		);
	});

	test("rejects invalid task names", async () => {
		await expect(service.add({ name: "BAD NAME", schedule: "0 0 * * *", command: "echo hi" })).rejects.toThrow(
			InvalidTaskNameError,
		);
		await expect(service.add({ name: "bad_name", schedule: "0 0 * * *", command: "echo hi" })).rejects.toThrow(
			InvalidTaskNameError,
		);
		await expect(service.add({ name: "-leading", schedule: "0 0 * * *", command: "echo hi" })).rejects.toThrow(
			InvalidTaskNameError,
		);
	});

	test("rejects empty command", async () => {
		await expect(service.add({ name: "empty-cmd", schedule: "0 0 * * *", command: "" })).rejects.toThrow(
			EmptyCommandError,
		);
		await expect(service.add({ name: "space-cmd", schedule: "0 0 * * *", command: "   " })).rejects.toThrow(
			EmptyCommandError,
		);
	});

	// @spec FR-047: Default notify to false — .specs/features/008-failure-notifications/spec.md#fr-047
	test("AC-067: creates task with notify false by default", async () => {
		const task = await service.add({
			name: "no-notify",
			schedule: "0 0 * * *",
			command: "echo test",
		});

		expect(task.notify).toBe(false);
	});

	// @spec FR-047: Notify field — .specs/features/008-failure-notifications/spec.md#fr-047
	test("AC-066: creates task with notify true when provided", async () => {
		const task = await service.add({
			name: "with-notify",
			schedule: "0 0 * * *",
			command: "echo test",
			notify: true,
		});

		expect(task.notify).toBe(true);
	});

	test("AC-004: creates directory and manifest on first add", async () => {
		const deepDir = join(tmpDir, "sub", "deep");
		const repo = new TaskRepository(join(deepDir, "tasks.json"));
		const svc = new TaskService(repo);

		const task = await svc.add({ name: "first", schedule: "0 0 * * *", command: "echo first" });
		expect(task.name).toBe("first");

		const file = Bun.file(join(deepDir, "tasks.json"));
		expect(await file.exists()).toBe(true);
	});
});

describe("TaskService.list", () => {
	test("AC-005: returns all tasks", async () => {
		await service.add({ name: "task-a", schedule: "0 0 * * *", command: "echo a" });
		await service.add({ name: "task-b", schedule: "0 1 * * *", command: "echo b" });

		const tasks = await service.list();
		expect(tasks).toHaveLength(2);
		expect(tasks.map((t) => t.name)).toEqual(["task-a", "task-b"]);
	});

	test("AC-007: returns empty array when no tasks", async () => {
		const tasks = await service.list();
		expect(tasks).toEqual([]);
	});
});

describe("TaskService.get", () => {
	test("AC-013: returns task details", async () => {
		await service.add({ name: "my-task", schedule: "0 2 * * *", command: "echo hi" });
		const task = await service.get("my-task");
		expect(task.name).toBe("my-task");
		expect(task.schedule).toBe("0 2 * * *");
		expect(task.command).toBe("echo hi");
		expect(task.id).toBeDefined();
		expect(task.createdAt).toBeDefined();
	});

	test("AC-009: throws for non-existent task", async () => {
		await expect(service.get("ghost")).rejects.toThrow(TaskNotFoundError);
	});
});

describe("TaskService.update", () => {
	test("AC-010: updates schedule", async () => {
		await service.add({ name: "my-task", schedule: "0 2 * * *", command: "echo hi" });
		const updated = await service.update("my-task", { schedule: "0 3 * * *" });
		expect(updated.schedule).toBe("0 3 * * *");
		expect(updated.updatedAt).toBeDefined();
	});

	test("AC-010: updates command", async () => {
		await service.add({ name: "my-task", schedule: "0 2 * * *", command: "echo hi" });
		const updated = await service.update("my-task", { command: "echo updated" });
		expect(updated.command).toBe("echo updated");
		expect(updated.updatedAt).toBeDefined();
	});

	test("AC-011: rejects invalid cron on update", async () => {
		await service.add({ name: "my-task", schedule: "0 2 * * *", command: "echo hi" });
		await expect(service.update("my-task", { schedule: "bad" })).rejects.toThrow(InvalidCronExpressionError);
	});

	test("AC-011: rejects empty command on update", async () => {
		await service.add({ name: "my-task", schedule: "0 2 * * *", command: "echo hi" });
		await expect(service.update("my-task", { command: "" })).rejects.toThrow(EmptyCommandError);
	});

	test("AC-012: rejects update with no changes", async () => {
		await service.add({ name: "my-task", schedule: "0 2 * * *", command: "echo hi" });
		await expect(service.update("my-task", {})).rejects.toThrow("No changes specified");
	});

	test("throws for non-existent task", async () => {
		await expect(service.update("ghost", { schedule: "0 0 * * *" })).rejects.toThrow(TaskNotFoundError);
	});

	// @spec FR-047: Update notify field — .specs/features/008-failure-notifications/spec.md#fr-047
	test("AC-068: updates notify to true", async () => {
		await service.add({ name: "my-task", schedule: "0 2 * * *", command: "echo hi" });
		const updated = await service.update("my-task", { notify: true });
		expect(updated.notify).toBe(true);
		expect(updated.updatedAt).toBeDefined();
	});

	test("AC-069: updates notify to false", async () => {
		await service.add({ name: "my-task", schedule: "0 2 * * *", command: "echo hi", notify: true });
		const updated = await service.update("my-task", { notify: false });
		expect(updated.notify).toBe(false);
	});
});

describe("TaskService.remove", () => {
	test("AC-008: removes a task", async () => {
		await service.add({ name: "my-task", schedule: "0 2 * * *", command: "echo hi" });
		await service.remove("my-task");
		const tasks = await service.list();
		expect(tasks).toHaveLength(0);
	});

	test("AC-009: throws for non-existent task", async () => {
		await expect(service.remove("ghost")).rejects.toThrow(TaskNotFoundError);
	});

	test("AC-019: removing last task leaves empty manifest", async () => {
		await service.add({ name: "only-task", schedule: "0 0 * * *", command: "echo only" });
		await service.remove("only-task");
		const tasks = await service.list();
		expect(tasks).toEqual([]);
	});
});

// @spec FR-056: Pause method — .specs/features/009-task-pause-resume/spec.md#fr-056
describe("TaskService.pause", () => {
	test("AC-001: pauses an active task and sets status to paused", async () => {
		await service.add({ name: "daily-backup", schedule: "0 2 * * *", command: "echo backup" });
		const paused = await service.pause("daily-backup");
		expect(paused.status).toBe("paused");
		expect(paused.name).toBe("daily-backup");
	});

	test("AC-013: pause sets updatedAt", async () => {
		await service.add({ name: "daily-backup", schedule: "0 2 * * *", command: "echo backup" });
		const paused = await service.pause("daily-backup");
		expect(paused.updatedAt).toBeDefined();
	});

	test("AC-001: paused status is persisted to manifest", async () => {
		await service.add({ name: "daily-backup", schedule: "0 2 * * *", command: "echo backup" });
		await service.pause("daily-backup");
		const task = await service.get("daily-backup");
		expect(task.status).toBe("paused");
	});

	test("AC-007: throws TaskNotFoundError for non-existent task", async () => {
		await expect(service.pause("ghost")).rejects.toThrow(TaskNotFoundError);
	});

	test("AC-005: throws TaskAlreadyPausedError for already-paused task", async () => {
		await service.add({ name: "daily-backup", schedule: "0 2 * * *", command: "echo backup" });
		await service.pause("daily-backup");
		await expect(service.pause("daily-backup")).rejects.toThrow(TaskAlreadyPausedError);
	});

	test("paused task preserves other fields", async () => {
		await service.add({ name: "daily-backup", schedule: "0 2 * * *", command: "echo backup", notify: true });
		const paused = await service.pause("daily-backup");
		expect(paused.schedule).toBe("0 2 * * *");
		expect(paused.command).toBe("echo backup");
		expect(paused.notify).toBe(true);
	});
});

// @spec FR-057: Resume method — .specs/features/009-task-pause-resume/spec.md#fr-057
describe("TaskService.resume", () => {
	test("AC-003: resumes a paused task and sets status to active", async () => {
		await service.add({ name: "daily-backup", schedule: "0 2 * * *", command: "echo backup" });
		await service.pause("daily-backup");
		const resumed = await service.resume("daily-backup");
		expect(resumed.status).toBe("active");
		expect(resumed.name).toBe("daily-backup");
	});

	test("AC-013: resume sets updatedAt", async () => {
		await service.add({ name: "daily-backup", schedule: "0 2 * * *", command: "echo backup" });
		await service.pause("daily-backup");
		const resumed = await service.resume("daily-backup");
		expect(resumed.updatedAt).toBeDefined();
	});

	test("AC-003: resumed status is persisted to manifest", async () => {
		await service.add({ name: "daily-backup", schedule: "0 2 * * *", command: "echo backup" });
		await service.pause("daily-backup");
		await service.resume("daily-backup");
		const task = await service.get("daily-backup");
		expect(task.status).toBe("active");
	});

	test("AC-007: throws TaskNotFoundError for non-existent task", async () => {
		await expect(service.resume("ghost")).rejects.toThrow(TaskNotFoundError);
	});

	test("AC-006: throws TaskAlreadyActiveError for already-active task", async () => {
		await service.add({ name: "daily-backup", schedule: "0 2 * * *", command: "echo backup" });
		await expect(service.resume("daily-backup")).rejects.toThrow(TaskAlreadyActiveError);
	});

	test("resumed task preserves other fields", async () => {
		await service.add({ name: "daily-backup", schedule: "0 2 * * *", command: "echo backup", notify: true });
		await service.pause("daily-backup");
		const resumed = await service.resume("daily-backup");
		expect(resumed.schedule).toBe("0 2 * * *");
		expect(resumed.command).toBe("echo backup");
		expect(resumed.notify).toBe(true);
	});
});

// @spec FR-004: Tags on add — .specs/features/013-task-groups-tags/spec.md#fr-004
describe("TaskService.add — tags", () => {
	test("AC-001: creates task with empty tags by default", async () => {
		const task = await service.add({ name: "no-tags", schedule: "0 0 * * *", command: "echo hi" });
		expect(task.tags).toEqual([]);
	});

	test("AC-002: creates task with provided tags", async () => {
		const task = await service.add({
			name: "tagged",
			schedule: "0 0 * * *",
			command: "echo hi",
			tags: ["backup", "db"],
		});
		expect(task.tags).toEqual(["backup", "db"]);
	});

	test("AC-003: rejects invalid tag format", async () => {
		await expect(
			service.add({ name: "bad-tag", schedule: "0 0 * * *", command: "echo hi", tags: ["BAD TAG"] }),
		).rejects.toThrow(InvalidTagError);
	});

	test("AC-003: rejects empty string tag", async () => {
		await expect(
			service.add({ name: "empty-tag", schedule: "0 0 * * *", command: "echo hi", tags: [""] }),
		).rejects.toThrow(InvalidTagError);
	});

	test("AC-007: deduplicates tags", async () => {
		const task = await service.add({
			name: "dup-tags",
			schedule: "0 0 * * *",
			command: "echo hi",
			tags: ["backup", "backup", "db"],
		});
		expect(task.tags).toEqual(["backup", "db"]);
	});

	test("AC-007: sorts tags alphabetically", async () => {
		const task = await service.add({
			name: "sorted-tags",
			schedule: "0 0 * * *",
			command: "echo hi",
			tags: ["z-tag", "a-tag", "m-tag"],
		});
		expect(task.tags).toEqual(["a-tag", "m-tag", "z-tag"]);
	});
});

// @spec FR-005: Tags on update — .specs/features/013-task-groups-tags/spec.md#fr-005
describe("TaskService.update — tags", () => {
	test("AC-005: adds tags to an existing task", async () => {
		await service.add({ name: "my-task", schedule: "0 0 * * *", command: "echo hi" });
		const updated = await service.update("my-task", { tags: ["backup"] });
		expect(updated.tags).toEqual(["backup"]);
	});

	test("AC-005: removes tags from an existing task", async () => {
		await service.add({ name: "my-task", schedule: "0 0 * * *", command: "echo hi", tags: ["backup", "db"] });
		const updated = await service.update("my-task", { untags: ["db"] });
		expect(updated.tags).toEqual(["backup"]);
	});

	test("AC-005: adds and removes tags simultaneously", async () => {
		await service.add({ name: "my-task", schedule: "0 0 * * *", command: "echo hi", tags: ["old"] });
		const updated = await service.update("my-task", { tags: ["new"], untags: ["old"] });
		expect(updated.tags).toEqual(["new"]);
	});

	test("AC-006: removing nonexistent tag is a no-op", async () => {
		await service.add({ name: "my-task", schedule: "0 0 * * *", command: "echo hi", tags: ["backup"] });
		const updated = await service.update("my-task", { untags: ["nonexistent"] });
		expect(updated.tags).toEqual(["backup"]);
	});

	test("AC-007: deduplicates after adding existing tag", async () => {
		await service.add({ name: "my-task", schedule: "0 0 * * *", command: "echo hi", tags: ["backup"] });
		const updated = await service.update("my-task", { tags: ["backup", "db"] });
		expect(updated.tags).toEqual(["backup", "db"]);
	});

	test("AC-013: tag-only update counts as valid change", async () => {
		await service.add({ name: "my-task", schedule: "0 0 * * *", command: "echo hi" });
		const updated = await service.update("my-task", { tags: ["backup"] });
		expect(updated.updatedAt).toBeDefined();
		expect(updated.tags).toEqual(["backup"]);
	});

	test("AC-013: untag-only update counts as valid change", async () => {
		await service.add({ name: "my-task", schedule: "0 0 * * *", command: "echo hi", tags: ["backup"] });
		const updated = await service.update("my-task", { untags: ["backup"] });
		expect(updated.tags).toEqual([]);
	});

	test("AC-004: rejects invalid tag on update", async () => {
		await service.add({ name: "my-task", schedule: "0 0 * * *", command: "echo hi" });
		await expect(service.update("my-task", { tags: ["BAD TAG"] })).rejects.toThrow(InvalidTagError);
	});

	test("AC-004: rejects invalid untag on update", async () => {
		await service.add({ name: "my-task", schedule: "0 0 * * *", command: "echo hi", tags: ["backup"] });
		await expect(service.update("my-task", { untags: ["BAD TAG"] })).rejects.toThrow(InvalidTagError);
	});

	test("removing all tags results in empty array", async () => {
		await service.add({ name: "my-task", schedule: "0 0 * * *", command: "echo hi", tags: ["only"] });
		const updated = await service.update("my-task", { untags: ["only"] });
		expect(updated.tags).toEqual([]);
	});
});

// @spec FR-006: Backward compat — .specs/features/013-task-groups-tags/spec.md#fr-006
describe("TaskRepository backward compat — tags", () => {
	test("AC-014: loads task without tags field with default empty array", async () => {
		// Write a manifest without tags field
		const tasksPath = join(tmpDir, "tasks.json");
		const manifest = {
			version: 1,
			tasks: [
				{
					id: "test-id",
					name: "legacy-task",
					schedule: "0 0 * * *",
					command: "echo legacy",
					status: "active",
					notify: false,
					createdAt: "2026-01-01T00:00:00.000Z",
				},
			],
		};
		await Bun.write(tasksPath, JSON.stringify(manifest));

		const repo = new TaskRepository(tasksPath);
		const loaded = await repo.load();
		expect(loaded.tasks[0]?.tags).toEqual([]);
	});
});
