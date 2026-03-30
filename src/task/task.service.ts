// @spec FR-002: Task CRUD, FR-003: Validation, FR-005: All operations — .specs/features/001-task-manifest/spec.md#fr-002

import { validateCronExpression } from "../cron/cron.service";
import type { Task, CreateTaskInput, UpdateTaskInput } from "./task.types";
import { TASK_NAME_REGEX } from "./task.types";
import { TaskRepository } from "./task.repository";
import {
	TaskNotFoundError,
	DuplicateTaskNameError,
	InvalidTaskNameError,
	EmptyCommandError,
	NoChangesSpecifiedError,
} from "./task.errors";

export class TaskService {
	constructor(private readonly repo: TaskRepository) {}

	/**
	 * Add a new task to the manifest.
	 * @param input Task creation input with name, command, and schedule
	 * @returns The created task with generated id and metadata
	 * @throws InvalidTaskNameError if name is not valid kebab-case
	 * @throws EmptyCommandError if command is empty or whitespace
	 * @throws InvalidCronExpressionError if schedule is invalid
	 * @throws DuplicateTaskNameError if a task with the same name exists
	 */
	async add(input: CreateTaskInput): Promise<Task> {
		if (!TASK_NAME_REGEX.test(input.name)) {
			throw new InvalidTaskNameError(input.name);
		}
		if (!input.command.trim()) {
			throw new EmptyCommandError();
		}
		validateCronExpression(input.schedule);

		const manifest = await this.repo.load();

		if (manifest.tasks.some((t) => t.name === input.name)) {
			throw new DuplicateTaskNameError(input.name);
		}

		const task: Task = {
			id: crypto.randomUUID(),
			name: input.name,
			schedule: input.schedule,
			command: input.command,
			status: "active",
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
	 * @param input Optional updates for schedule and/or command
	 * @returns The updated task
	 * @throws TaskNotFoundError if no task with this name exists
	 * @throws NoChangesSpecifiedError if no fields are provided
	 * @throws EmptyCommandError if command is updated to empty/whitespace
	 * @throws InvalidCronExpressionError if schedule is invalid
	 */
	async update(name: string, input: UpdateTaskInput): Promise<Task> {
		const hasSchedule = input.schedule !== undefined;
		const hasCommand = input.command !== undefined;

		if (!hasSchedule && !hasCommand) {
			throw new NoChangesSpecifiedError();
		}

		if (hasCommand && !input.command!.trim()) {
			throw new EmptyCommandError();
		}

		if (hasSchedule) {
			validateCronExpression(input.schedule!);
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
}
