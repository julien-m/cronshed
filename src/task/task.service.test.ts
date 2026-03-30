import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { TaskService } from "./task.service";
import { TaskRepository } from "./task.repository";
import {
	TaskNotFoundError,
	DuplicateTaskNameError,
	InvalidTaskNameError,
	EmptyCommandError,
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
