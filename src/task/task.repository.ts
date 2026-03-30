// @spec FR-001: Storage read/write, FR-004: Atomic writes, FR-007: Auto-create, FR-009: Corruption, FR-010: Version — .specs/features/001-task-manifest/spec.md#fr-001

import { dirname } from "node:path";
import { mkdir, rename, unlink } from "node:fs/promises";
import { getTasksPath } from "../app/config";
import type { TaskManifest } from "./task.types";
import { MANIFEST_VERSION } from "./task.types";
import { ManifestCorruptedError, ManifestVersionError, ManifestAccessError } from "./task.errors";

export class TaskRepository {
	private readonly tasksPath: string;

	constructor(tasksPath?: string) {
		this.tasksPath = tasksPath ?? getTasksPath();
	}

	/**
	 * Load the task manifest from disk.
	 * Returns an empty manifest if the file does not exist.
	 * @returns The deserialized manifest
	 * @throws ManifestVersionError if manifest version is unsupported
	 * @throws ManifestCorruptedError if manifest structure is invalid
	 * @throws ManifestAccessError if file cannot be read
	 */
	async load(): Promise<TaskManifest> {
		const file = Bun.file(this.tasksPath);
		const exists = await file.exists();

		if (!exists) {
			return { version: 1, tasks: [] };
		}

		let raw: string;
		try {
			raw = await file.text();
		} catch (err) {
			throw new ManifestAccessError(this.tasksPath, err instanceof Error ? err : undefined);
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			throw new ManifestCorruptedError(this.tasksPath);
		}

		if (
			typeof parsed !== "object" ||
			parsed === null ||
			!("version" in parsed) ||
			!("tasks" in parsed)
		) {
			throw new ManifestCorruptedError(this.tasksPath);
		}

		const manifest = parsed as { version: unknown; tasks: unknown };
		if (manifest.version !== MANIFEST_VERSION) {
			throw new ManifestVersionError(MANIFEST_VERSION, manifest.version);
		}

		// Backward compat: tasks created before 008-failure-notifications have no notify field
		const result = parsed as TaskManifest;
		for (const task of result.tasks) {
			if ((task as unknown as Record<string, unknown>).notify === undefined) {
				task.notify = false;
			}
		}
		return result;
	}

	/**
	 * Save the task manifest to disk atomically.
	 * Uses a temporary file and rename to prevent corruption on write failure.
	 * @param manifest The manifest to persist
	 * @throws ManifestAccessError if directory cannot be created or file cannot be written
	 */
	async save(manifest: TaskManifest): Promise<void> {
		const dir = dirname(this.tasksPath);
		await mkdir(dir, { recursive: true });

		const tmpPath = `${this.tasksPath}.tmp.${Date.now()}`;
		const data = JSON.stringify(manifest, null, "\t");

		try {
			await Bun.write(tmpPath, data + "\n");
			await rename(tmpPath, this.tasksPath);
		} catch (err) {
			// Clean up tmp file on failure
			try {
				await unlink(tmpPath);
			} catch {
				// best-effort cleanup
			}
			throw new ManifestAccessError(this.tasksPath, err instanceof Error ? err : undefined);
		}
	}

	/** Ensure the data directory exists, creating it recursively if needed. */
	async ensureDataDir(): Promise<void> {
		const dir = dirname(this.tasksPath);
		await mkdir(dir, { recursive: true });
	}

	/** Get the resolved path to the tasks.json file. */
	getPath(): string {
		return this.tasksPath;
	}
}
