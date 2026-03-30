import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { TaskService } from "./task.service";
import { TaskRepository } from "./task.repository";
import {
	TaskNotFoundError,
	DuplicateTaskNameError,
	InvalidTaskNameError,
	EmptyCommandError,
	TaskAlreadyPausedError,
	TaskAlreadyActiveError,
} from "./task.errors";
import { InvalidCronExpressionError } from "../cron/cron.errors";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";

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
		expect(service.add({ name: "my-task", schedule: "0 1 * * *", command: "echo dup" })).rejects.toThrow(DuplicateTaskNameError);
	});

	test("AC-002: rejects invalid cron expressions", async () => {
		expect(service.add({ name: "bad-cron", schedule: "bad", command: "echo hi" })).rejects.toThrow(InvalidCronExpressionError);
	});

	test("rejects invalid task names", async () => {
		expect(service.add({ name: "BAD NAME", schedule: "0 0 * * *", command: "echo hi" })).rejects.toThrow(InvalidTaskNameError);
		expect(service.add({ name: "bad_name", schedule: "0 0 * * *", command: "echo hi" })).rejects.toThrow(InvalidTaskNameError);
		expect(service.add({ name: "-leading", schedule: "0 0 * * *", command: "echo hi" })).rejects.toThrow(InvalidTaskNameError);
	});

	test("rejects empty command", async () => {
		expect(service.add({ name: "empty-cmd", schedule: "0 0 * * *", command: "" })).rejects.toThrow(EmptyCommandError);
		expect(service.add({ name: "space-cmd", schedule: "0 0 * * *", command: "   " })).rejects.toThrow(EmptyCommandError);
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
		expect(service.get("ghost")).rejects.toThrow(TaskNotFoundError);
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
		expect(service.update("my-task", { schedule: "bad" })).rejects.toThrow(InvalidCronExpressionError);
	});

	test("AC-011: rejects empty command on update", async () => {
		await service.add({ name: "my-task", schedule: "0 2 * * *", command: "echo hi" });
		expect(service.update("my-task", { command: "" })).rejects.toThrow(EmptyCommandError);
	});

	test("AC-012: rejects update with no changes", async () => {
		await service.add({ name: "my-task", schedule: "0 2 * * *", command: "echo hi" });
		expect(service.update("my-task", {})).rejects.toThrow("No changes specified");
	});

	test("throws for non-existent task", async () => {
		expect(service.update("ghost", { schedule: "0 0 * * *" })).rejects.toThrow(TaskNotFoundError);
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
		expect(service.remove("ghost")).rejects.toThrow(TaskNotFoundError);
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
		expect(service.pause("ghost")).rejects.toThrow(TaskNotFoundError);
	});

	test("AC-005: throws TaskAlreadyPausedError for already-paused task", async () => {
		await service.add({ name: "daily-backup", schedule: "0 2 * * *", command: "echo backup" });
		await service.pause("daily-backup");
		expect(service.pause("daily-backup")).rejects.toThrow(TaskAlreadyPausedError);
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
		expect(service.resume("ghost")).rejects.toThrow(TaskNotFoundError);
	});

	test("AC-006: throws TaskAlreadyActiveError for already-active task", async () => {
		await service.add({ name: "daily-backup", schedule: "0 2 * * *", command: "echo backup" });
		expect(service.resume("daily-backup")).rejects.toThrow(TaskAlreadyActiveError);
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
