import { test, expect, describe, beforeEach } from "bun:test";
import { TaskRepository } from "./task.repository";
import { ManifestCorruptedError, ManifestVersionError } from "./task.errors";
import type { TaskManifest } from "./task.types";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";

let tmpDir: string;
let tasksPath: string;
let repo: TaskRepository;

beforeEach(async () => {
	tmpDir = await mkdtemp(join(tmpdir(), "cronshed-repo-test-"));
	tasksPath = join(tmpDir, "tasks.json");
	repo = new TaskRepository(tasksPath);
});

describe("TaskRepository.load", () => {
	test("returns empty manifest when file does not exist", async () => {
		const manifest = await repo.load();
		expect(manifest.version).toBe(1);
		expect(manifest.tasks).toEqual([]);
	});

	test("AC-018: throws ManifestCorruptedError for invalid JSON", async () => {
		await Bun.write(tasksPath, "not json at all");
		expect(repo.load()).rejects.toThrow(ManifestCorruptedError);
	});

	test("AC-018: throws ManifestCorruptedError for JSON without required fields", async () => {
		await Bun.write(tasksPath, JSON.stringify({ foo: "bar" }));
		expect(repo.load()).rejects.toThrow(ManifestCorruptedError);
	});

	test("FR-010: throws ManifestVersionError for unrecognized version", async () => {
		await Bun.write(tasksPath, JSON.stringify({ version: 2, tasks: [] }));
		expect(repo.load()).rejects.toThrow(ManifestVersionError);
	});

	test("loads valid manifest", async () => {
		const data: TaskManifest = {
			version: 1,
			tasks: [
				{
					id: "test-id",
					name: "test-task",
					schedule: "0 0 * * *",
					command: "echo hi",
					status: "active",
					notify: false,
					createdAt: "2026-03-30T00:00:00Z",
				},
			],
		};
		await Bun.write(tasksPath, JSON.stringify(data));
		const manifest = await repo.load();
		expect(manifest.tasks).toHaveLength(1);
		expect(manifest.tasks[0]!.name).toBe("test-task");
	});

	test("backward compat: loads task without notify field and defaults to false", async () => {
		const data = {
			version: 1,
			tasks: [
				{
					id: "old-id",
					name: "old-task",
					schedule: "0 0 * * *",
					command: "echo old",
					status: "active",
					createdAt: "2026-03-30T00:00:00Z",
				},
			],
		};
		await Bun.write(tasksPath, JSON.stringify(data));
		const manifest = await repo.load();
		expect(manifest.tasks[0]!.notify).toBe(false);
	});
});

describe("TaskRepository.save", () => {
	test("AC-004: creates directory and file", async () => {
		const deepPath = join(tmpDir, "sub", "deep", "tasks.json");
		const deepRepo = new TaskRepository(deepPath);

		await deepRepo.save({ version: 1, tasks: [] });

		const file = Bun.file(deepPath);
		expect(await file.exists()).toBe(true);
	});

	test("AC-015: uses atomic write (file content is valid JSON after save)", async () => {
		const manifest: TaskManifest = {
			version: 1,
			tasks: [
				{
					id: "atomic-test",
					name: "atomic",
					schedule: "0 0 * * *",
					command: "echo atomic",
					status: "active",
					notify: false,
					createdAt: "2026-03-30T00:00:00Z",
				},
			],
		};

		await repo.save(manifest);
		const loaded = await repo.load();
		expect(loaded.tasks[0]!.name).toBe("atomic");
	});

	test("AC-019: saving empty tasks array produces valid manifest", async () => {
		await repo.save({ version: 1, tasks: [] });
		const loaded = await repo.load();
		expect(loaded.version).toBe(1);
		expect(loaded.tasks).toEqual([]);
	});
});
