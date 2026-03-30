// @spec FR-002: Task CRUD, FR-003: Validation, FR-005: All operations — .specs/features/001-task-manifest/spec.md#fr-002

import { validateCronExpression } from "../cron/cron.service";
import type { Task, CreateTaskInput, UpdateTaskInput } from "./task.types";
import { TASK_NAME_REGEX, TASK_STATUS, TAG_REGEX, normalizeTags } from "./task.types";
import { TaskRepository } from "./task.repository";
import {
	TaskNotFoundError,
	DuplicateTaskNameError,
	InvalidTaskNameError,
	EmptyCommandError,
	NoChangesSpecifiedError,
	TaskAlreadyPausedError,
	TaskAlreadyActiveError,
	InvalidTagError,
} from "./task.errors";

export class TaskService {
	constructor(private readonly repo: TaskRepository) {}

	/**
	 * Add a new task to the manifest.
	 * @param input Task creation input with name, command, schedule, and optional tags
	 * @returns The created task with generated id and metadata
	 * @throws InvalidTaskNameError if name is not valid kebab-case
	 * @throws EmptyCommandError if command is empty or whitespace
	 * @throws InvalidCronExpressionError if schedule is invalid
	 * @throws DuplicateTaskNameError if a task with the same name exists
	 * @throws InvalidTagError if any tag is not valid kebab-case
	 */
	async add(input: CreateTaskInput): Promise<Task> {
		if (!TASK_NAME_REGEX.test(input.name)) {
			throw new InvalidTaskNameError(input.name);
		}
		if (!input.command.trim()) {
			throw new EmptyCommandError();
		}
		validateCronExpression(input.schedule);

		// @spec FR-004: Validate tags on add — .specs/features/013-task-groups-tags/spec.md#fr-004
		const tags = input.tags ?? [];
		for (const tag of tags) {
			if (!TAG_REGEX.test(tag)) {
				throw new InvalidTagError(tag);
			}
		}

		const manifest = await this.repo.load();

		if (manifest.tasks.some((t) => t.name === input.name)) {
			throw new DuplicateTaskNameError(input.name);
		}

		// @spec FR-047: Default notify to false — .specs/features/008-failure-notifications/spec.md#fr-047
		const task: Task = {
			id: crypto.randomUUID(),
			name: input.name,
			schedule: input.schedule,
			command: input.command,
			status: "active",
			notify: input.notify ?? false,
			tags: normalizeTags(tags),
			createdAt: new Date().toISOString(),
		};

		manifest.tasks.push(task);
		await this.repo.save(manifest);

		return task;
	}

	/**
	 * Retrieve all tasks from the manifest.
	 * @returns Array of all tasks (may be empty)
	 */
	async list(): Promise<Task[]> {
		const manifest = await this.repo.load();
		return manifest.tasks;
	}

	/**
	 * Retrieve a task by name.
	 * @param name The task name to look up
	 * @returns The matching task
	 * @throws TaskNotFoundError if no task with this name exists
	 */
	async get(name: string): Promise<Task> {
		const manifest = await this.repo.load();
		const task = manifest.tasks.find((t) => t.name === name);
		if (!task) {
			throw new TaskNotFoundError(name);
		}
		return task;
	}

	/**
	 * Update one or more properties of an existing task.
	 * @param name The task name to update
	 * @param input Optional updates for schedule, command, notify, tags, untags
	 * @returns The updated task
	 * @throws TaskNotFoundError if no task with this name exists
	 * @throws NoChangesSpecifiedError if no fields are provided
	 * @throws EmptyCommandError if command is updated to empty/whitespace
	 * @throws InvalidCronExpressionError if schedule is invalid
	 * @throws InvalidTagError if any tag is not valid kebab-case
	 */
	async update(name: string, input: UpdateTaskInput): Promise<Task> {
		const hasSchedule = input.schedule !== undefined;
		const hasCommand = input.command !== undefined;
		const hasNotify = input.notify !== undefined;
		// @spec FR-005: Tag/untag on update — .specs/features/013-task-groups-tags/spec.md#fr-005
		const hasTags = input.tags !== undefined && input.tags.length > 0;
		const hasUntags = input.untags !== undefined && input.untags.length > 0;

		if (!hasSchedule && !hasCommand && !hasNotify && !hasTags && !hasUntags) {
			throw new NoChangesSpecifiedError();
		}

		if (hasCommand && !input.command!.trim()) {
			throw new EmptyCommandError();
		}

		if (hasSchedule) {
			validateCronExpression(input.schedule!);
		}

		// Validate tags before any mutation
		if (hasTags) {
			for (const tag of input.tags!) {
				if (!TAG_REGEX.test(tag)) {
					throw new InvalidTagError(tag);
				}
			}
		}
		if (hasUntags) {
			for (const tag of input.untags!) {
				if (!TAG_REGEX.test(tag)) {
					throw new InvalidTagError(tag);
				}
			}
		}

		const manifest = await this.repo.load();
		const task = manifest.tasks.find((t) => t.name === name);
		if (!task) {
			throw new TaskNotFoundError(name);
		}

		if (hasSchedule) {
			task.schedule = input.schedule!;
		}
		if (hasCommand) {
			task.command = input.command!;
		}
		// @spec FR-047: Update notify field — .specs/features/008-failure-notifications/spec.md#fr-047
		if (hasNotify) {
			task.notify = input.notify!;
		}

		// @spec FR-005: Apply tag additions and removals — .specs/features/013-task-groups-tags/spec.md#fr-005
		if (hasTags || hasUntags) {
			let currentTags = new Set(task.tags);
			if (hasTags) {
				for (const tag of input.tags!) {
					currentTags.add(tag);
				}
			}
			if (hasUntags) {
				for (const tag of input.untags!) {
					currentTags.delete(tag);
				}
			}
			task.tags = normalizeTags([...currentTags]);
		}

		task.updatedAt = new Date().toISOString();

		await this.repo.save(manifest);
		return task;
	}

	/**
	 * Remove a task from the manifest.
	 * @param name The task name to remove
	 * @throws TaskNotFoundError if no task with this name exists
	 */
	async remove(name: string): Promise<void> {
		const manifest = await this.repo.load();
		const index = manifest.tasks.findIndex((t) => t.name === name);
		if (index === -1) {
			throw new TaskNotFoundError(name);
		}

		manifest.tasks.splice(index, 1);
		await this.repo.save(manifest);
	}

	/**
	 * Pause an active task by setting its status to "paused".
	 * @param name The task name to pause
	 * @returns The updated task
	 * @throws TaskNotFoundError if no task with this name exists
	 * @throws TaskAlreadyPausedError if the task is already paused
	 */
	// @spec FR-056: Pause method with validation — .specs/features/009-task-pause-resume/spec.md#fr-056
	async pause(name: string): Promise<Task> {
		const manifest = await this.repo.load();
		const task = manifest.tasks.find((t) => t.name === name);
		if (!task) {
			throw new TaskNotFoundError(name);
		}
		if (task.status === TASK_STATUS.PAUSED) {
			throw new TaskAlreadyPausedError(name);
		}

		task.status = TASK_STATUS.PAUSED;
		task.updatedAt = new Date().toISOString();
		await this.repo.save(manifest);
		return task;
	}

	/**
	 * Resume a paused task by setting its status to "active".
	 * @param name The task name to resume
	 * @returns The updated task
	 * @throws TaskNotFoundError if no task with this name exists
	 * @throws TaskAlreadyActiveError if the task is already active
	 */
	// @spec FR-057: Resume method with validation — .specs/features/009-task-pause-resume/spec.md#fr-057
	async resume(name: string): Promise<Task> {
		const manifest = await this.repo.load();
		const task = manifest.tasks.find((t) => t.name === name);
		if (!task) {
			throw new TaskNotFoundError(name);
		}
		if (task.status === TASK_STATUS.ACTIVE) {
			throw new TaskAlreadyActiveError(name);
		}

		task.status = TASK_STATUS.ACTIVE;
		task.updatedAt = new Date().toISOString();
		await this.repo.save(manifest);
		return task;
	}
}
