// Query handlers: list, get, history, tags — and shared task enrichment helpers.
// @spec FR-007: Enrich tasks in list, FR-008: Enrich task in get — .specs/features/006-task-listing-status/spec.md#fr-007

import { parseArgs } from "node:util";
import { getNextExecution } from "../../cron/cron.service";
import { getExecutionHistory, getLastExecution } from "../../log/log.service";
import type { TaskService } from "../../task/task.service";
import type { EnrichedTask, Task } from "../../task/task.types";
import { TASK_STATUS } from "../../task/task.types";
import { formatError } from "../formatters/base.formatter";
import { formatTagsTable } from "../formatters/ops.formatter";
import { formatHistoryTable, formatTaskDetails, formatTaskTable } from "../formatters/task.formatter";

/**
 * Enrich a single task with last execution and next run data.
 * Paused tasks show "—" for nextRun since they will not execute.
 * @spec FR-060: Paused tasks show "--" for nextRun — .specs/features/009-task-pause-resume/spec.md#fr-060
 * @param task The raw task from the manifest
 * @returns Enriched task with lastRun, lastExitCode, nextRun
 */
export async function enrichTask(task: Task): Promise<EnrichedTask> {
	const lastExec = await getLastExecution(task.name);
	const nextRun = task.status === TASK_STATUS.PAUSED ? "\u2014" : getNextExecution(task.schedule).toISOString();

	return {
		...task,
		lastRun: lastExec?.timestamp ?? null,
		lastExitCode: lastExec?.exitCode ?? null,
		nextRun,
	};
}

/**
 * Enrich an array of tasks with last execution and next run data.
 * @param tasks Array of raw tasks from the manifest
 * @returns Array of enriched tasks
 */
export async function enrichTasks(tasks: Task[]): Promise<EnrichedTask[]> {
	return Promise.all(tasks.map((task) => enrichTask(task)));
}

// @spec FR-007: Enrich tasks in list, FR-009: JSON output with enriched data — .specs/features/006-task-listing-status/spec.md#fr-007
// @spec FR-011: List filter by tag — .specs/features/013-task-groups-tags/spec.md#fr-011
export async function handleList(args: string[], service: TaskService): Promise<void> {
	const { values } = parseArgs({
		args,
		options: {
			json: { type: "boolean", default: false },
			tag: { type: "string" },
		},
		allowPositionals: false,
	});

	let tasks = await service.list();

	// @spec FR-011: Filter tasks by tag — .specs/features/013-task-groups-tags/spec.md#fr-011
	const filterTag = values.tag;
	if (filterTag) {
		tasks = tasks.filter((t) => t.tags.includes(filterTag));
		if (tasks.length === 0) {
			if (values.json) {
				console.log(JSON.stringify([], null, "\t"));
			} else {
				console.log(`No tasks found with tag "${filterTag}"`);
			}
			return;
		}
	}

	if (tasks.length === 0) {
		if (values.json) {
			console.log(JSON.stringify([], null, "\t"));
		} else {
			console.log("No tasks configured. Run 'cronshed add' to create your first task.");
		}
		return;
	}

	const enriched = await enrichTasks(tasks);

	if (values.json) {
		console.log(JSON.stringify(enriched, null, "\t"));
		return;
	}

	console.log(formatTaskTable(enriched));
}

// @spec FR-008: Enrich task in get, FR-010: JSON output with enriched data — .specs/features/006-task-listing-status/spec.md#fr-008
export async function handleGet(args: string[], service: TaskService): Promise<void> {
	const name = args[0];
	if (!name) {
		console.error(formatError("Missing task name", "Usage: cronshed get <name>"));
		process.exit(2);
		return;
	}

	const restArgs = args.slice(1);
	const { values } = parseArgs({
		args: restArgs,
		options: {
			json: { type: "boolean", default: false },
		},
		allowPositionals: false,
	});

	const task = await service.get(name);
	const enriched = await enrichTask(task);

	if (values.json) {
		console.log(JSON.stringify(enriched, null, "\t"));
		return;
	}

	console.log(formatTaskDetails(enriched));
}

/** Default number of history entries to display. */
const DEFAULT_HISTORY_LIMIT = 10;

// @spec FR-003: History handler, FR-006: Command registration, FR-008: --limit flag, FR-009: Task validation, FR-010: No history message — .specs/features/007-execution-history/spec.md#fr-003
export async function handleHistory(args: string[], service: TaskService): Promise<void> {
	const name = args[0];
	if (!name) {
		console.error(formatError("Missing task name", "Usage: cronshed history <name> [--limit N] [--json]"));
		process.exit(2);
		return;
	}

	const restArgs = args.slice(1);
	const { values } = parseArgs({
		args: restArgs,
		options: {
			limit: { type: "string", short: "n" },
			json: { type: "boolean", default: false },
		},
		allowPositionals: false,
	});

	const limit = values.limit !== undefined ? parseInt(values.limit, 10) : DEFAULT_HISTORY_LIMIT;
	if (Number.isNaN(limit) || limit < 0) {
		console.error(formatError("Invalid --limit value", "Must be a non-negative integer"));
		process.exit(2);
		return;
	}

	// Validate task exists before reading logs
	await service.get(name);

	const entries = await getExecutionHistory(name);

	if (entries.length === 0) {
		if (values.json) {
			console.log(JSON.stringify([], null, "\t"));
		} else {
			console.log(`No execution history for ${name}`);
		}
		return;
	}

	// Reverse for most-recent-first, then apply limit
	const reversed = entries.toReversed();
	const limited = limit === 0 ? [] : reversed.slice(0, limit);

	if (values.json) {
		console.log(JSON.stringify(limited, null, "\t"));
		return;
	}

	if (limited.length === 0) {
		console.log(`No execution history for ${name}`);
		return;
	}

	console.log(formatHistoryTable(limited));
}

// @spec FR-012: Tags subcommand — .specs/features/013-task-groups-tags/spec.md#fr-012
export async function handleTags(args: string[], service: TaskService): Promise<void> {
	const { values } = parseArgs({
		args,
		options: {
			json: { type: "boolean", default: false },
		},
		allowPositionals: false,
	});

	const tasks = await service.list();
	const tagCounts = new Map<string, number>();

	for (const task of tasks) {
		for (const tag of task.tags) {
			tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
		}
	}

	if (tagCounts.size === 0) {
		if (values.json) {
			console.log(JSON.stringify({}, null, "\t"));
		} else {
			console.log("No tags in use");
		}
		return;
	}

	if (values.json) {
		const obj: Record<string, number> = {};
		for (const [tag, count] of [...tagCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
			obj[tag] = count;
		}
		console.log(JSON.stringify(obj, null, "\t"));
		return;
	}

	console.log(formatTagsTable(tagCounts));
}
