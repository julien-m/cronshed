// @spec FR-005: Subcommand routing, FR-008: Error handling — .specs/features/001-task-manifest/spec.md#fr-005

import { parseArgs } from "node:util";
import { TaskService } from "../task/task.service";
import { TaskRepository } from "../task/task.repository";
import { SyncService } from "../crontab/sync.service";
import { CrontabAdapter } from "../crontab/crontab.adapter";
import { CrontabReadError, CrontabWriteError } from "../crontab/crontab.errors";
import { InvalidCronExpressionError } from "../cron/cron.errors";
import {
	TaskNotFoundError,
	DuplicateTaskNameError,
	InvalidTaskNameError,
	EmptyCommandError,
	NoChangesSpecifiedError,
	ManifestCorruptedError,
	ManifestVersionError,
	ManifestAccessError,
} from "../task/task.errors";
import { resolveCommand } from "./command.resolver";
import {
	CommandFileNotFoundError,
	CommandFileNotExecutableError,
	CommandPathIsDirectoryError,
} from "./command.errors";
import { WrapperService } from "../wrapper/wrapper.service";
import { WrapperGenerationError } from "../wrapper/wrapper.errors";
import { getDataDir } from "../app/config";
import { getNextExecution } from "../cron/cron.service";
import { getLastExecution } from "../log/log.service";
import type { Task, EnrichedTask } from "../task/task.types";
import { formatTaskTable, formatTaskDetails, formatHistoryTable, formatSuccess, formatError, formatWarning, formatSyncConfirmation, formatSyncResult, formatSyncDiff } from "./cli.formatter";
import { getExecutionHistory } from "../log/log.service";

// @spec FR-022: Sync handler, FR-024: Dry-run display, FR-027: Error handling — .specs/features/003-crontab-sync/spec.md#fr-022
async function handleSync(args: string[]): Promise<void> {
	const { values } = parseArgs({
		args,
		options: {
			"dry-run": { type: "boolean", default: false },
			clear: { type: "boolean", default: false },
		},
		allowPositionals: false,
	});

	const repo = new TaskRepository();
	const adapter = new CrontabAdapter();
	const wrapperService = new WrapperService(getDataDir());
	const syncService = new SyncService(repo, adapter, wrapperService);

	const result = await syncService.sync({
		dryRun: values["dry-run"],
		clear: values.clear,
	});

	if (!result.isUpToDate && values["dry-run"]) {
		console.log(formatSyncDiff(result.diff));
		return;
	}

	console.log(formatSyncResult(result, values.clear ?? false));
}

// @spec FR-029, FR-030, FR-031, FR-032, FR-033: Auto-sync after mutations — .specs/features/004-auto-sync/spec.md#fr-029
// @spec FR-044: Auto-sync passes WrapperService — .specs/features/005-wrapper-script-generation/spec.md#fr-044
async function autoSync(repo: TaskRepository): Promise<void> {
	try {
		const adapter = new CrontabAdapter();
		const wrapperService = new WrapperService(getDataDir());
		const syncService = new SyncService(repo, adapter, wrapperService);
		await syncService.sync();
		console.log(formatSyncConfirmation());
	} catch (error) {
		// Non-fatal sync errors: manifest mutation succeeded but crontab sync failed
		// Log the actual error details for debugging without exposing implementation details
		const errorDetail = error instanceof Error ? error.message : String(error);
		const hint = `Could not sync to crontab: ${errorDetail}. Run 'cronshed sync' to retry`;
		console.error(formatWarning("Sync skipped", hint));
	}
}

function getExitCode(err: unknown): number {
	if (
		err instanceof InvalidCronExpressionError ||
		err instanceof InvalidTaskNameError ||
		err instanceof EmptyCommandError ||
		err instanceof CommandFileNotFoundError ||
		err instanceof CommandFileNotExecutableError ||
		err instanceof CommandPathIsDirectoryError
	) {
		return 2;
	}
	if (
		err instanceof ManifestCorruptedError || err instanceof ManifestVersionError || err instanceof ManifestAccessError ||
		err instanceof CrontabReadError || err instanceof CrontabWriteError ||
		err instanceof WrapperGenerationError
	) {
		return 3;
	}
	if (err instanceof TaskNotFoundError || err instanceof DuplicateTaskNameError) {
		return 1;
	}
	if (err instanceof NoChangesSpecifiedError) {
		return 2;
	}
	return 1;
}

function getErrorHint(err: unknown): string | undefined {
	if (err instanceof InvalidCronExpressionError) {
		return "Expected format: '* * * * *' (minute hour day month weekday)";
	}
	if (err instanceof ManifestCorruptedError) {
		return `Inspect manually: ${err.path}`;
	}
	if (err instanceof ManifestVersionError) {
		return "Update cronshed or check tasks.json manually";
	}
	if (err instanceof ManifestAccessError) {
		return `Check permissions for: ${err.path}`;
	}
	if (err instanceof CrontabReadError || err instanceof CrontabWriteError) {
		return "Check crontab permissions or run 'crontab -e' to verify access";
	}
	if (err instanceof CommandFileNotFoundError) {
		return `Resolved to: ${err.resolved}`;
	}
	if (err instanceof CommandFileNotExecutableError) {
		return `Run: chmod +x ${err.resolved}`;
	}
	if (err instanceof CommandPathIsDirectoryError) {
		return "Expected a file, not a directory";
	}
	if (err instanceof WrapperGenerationError) {
		return "Check permissions for the wrappers directory";
	}
	return undefined;
}

// @spec FR-029, FR-034: Auto-sync on add with --no-sync flag — .specs/features/004-auto-sync/spec.md#fr-029
async function handleAdd(args: string[], service: TaskService, repo: TaskRepository): Promise<void> {
	const name = args[0];
	if (!name) {
		console.error(formatError("Missing task name", "Usage: cronshed add <name> --schedule '<cron>' --command '<cmd>'"));
		process.exit(2);
	}

	const { values } = parseArgs({
		args: args.slice(1),
		options: {
			schedule: { type: "string", short: "s" },
			command: { type: "string", short: "c" },
			"no-sync": { type: "boolean", default: false },
		},
		allowPositionals: false,
	});

	if (!values.schedule) {
		console.error(formatError("Missing --schedule flag", "Usage: cronshed add <name> --schedule '<cron>' --command '<cmd>'"));
		process.exit(2);
	}
	if (!values.command) {
		console.error(formatError("Missing --command flag", "Usage: cronshed add <name> --schedule '<cron>' --command '<cmd>'"));
		process.exit(2);
	}

	// @spec FR-016: Include resolved path in success message, FR-017: Path resolution on add — .specs/features/002-command-path-resolution/spec.md#fr-016
	const resolution = await resolveCommand(values.command);

	const task = await service.add({
		name,
		schedule: values.schedule,
		command: resolution.resolved,
	});

	// @spec FR-042: Generate wrapper on add — .specs/features/005-wrapper-script-generation/spec.md#fr-042
	const wrapperService = new WrapperService(getDataDir());
	await wrapperService.generate(task);

	if (resolution.isFilePath) {
		console.log(formatSuccess(`Task ${task.name} created (command: ${resolution.resolved})`));
	} else {
		console.log(formatSuccess(`Task ${task.name} created`));
	}

	if (!values["no-sync"]) {
		await autoSync(repo);
	}
}

// @spec FR-007: Enrich tasks in list, FR-009: JSON output with enriched data — .specs/features/006-task-listing-status/spec.md#fr-007
async function handleList(args: string[], service: TaskService): Promise<void> {
	const { values } = parseArgs({
		args,
		options: {
			json: { type: "boolean", default: false },
		},
		allowPositionals: false,
	});

	const tasks = await service.list();

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
async function handleGet(args: string[], service: TaskService): Promise<void> {
	const name = args[0];
	if (!name) {
		console.error(formatError("Missing task name", "Usage: cronshed get <name>"));
		process.exit(2);
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

// @spec FR-031, FR-034: Auto-sync on update with --no-sync flag — .specs/features/004-auto-sync/spec.md#fr-031
async function handleUpdate(args: string[], service: TaskService, repo: TaskRepository): Promise<void> {
	const name = args[0];
	if (!name) {
		console.error(formatError("Missing task name", "Usage: cronshed update <name> --schedule '<cron>' --command '<cmd>'"));
		process.exit(2);
	}

	const { values } = parseArgs({
		args: args.slice(1),
		options: {
			schedule: { type: "string", short: "s" },
			command: { type: "string", short: "c" },
			"no-sync": { type: "boolean", default: false },
		},
		allowPositionals: false,
	});

	// @spec FR-017: Path resolution on update — .specs/features/002-command-path-resolution/spec.md#fr-017
	let resolvedCommand = values.command;
	if (values.command) {
		const resolution = await resolveCommand(values.command);
		resolvedCommand = resolution.resolved;
	}

	const task = await service.update(name, {
		schedule: values.schedule,
		command: resolvedCommand,
	});

	// @spec FR-042: Regenerate wrapper only on command change — .specs/features/005-wrapper-script-generation/spec.md#fr-042
	if (values.command) {
		const wrapperService = new WrapperService(getDataDir());
		await wrapperService.generate(task);
	}

	console.log(formatSuccess(`Task ${task.name} updated`));

	if (!values["no-sync"]) {
		await autoSync(repo);
	}
}

// @spec FR-030, FR-034: Auto-sync on remove with --no-sync flag — .specs/features/004-auto-sync/spec.md#fr-030
async function handleRemove(args: string[], service: TaskService, repo: TaskRepository): Promise<void> {
	const name = args[0];
	if (!name) {
		console.error(formatError("Missing task name", "Usage: cronshed remove <name>"));
		process.exit(2);
	}

	const { values } = parseArgs({
		args: args.slice(1),
		options: {
			"no-sync": { type: "boolean", default: false },
		},
		allowPositionals: false,
	});

	await service.remove(name);

	// @spec FR-043: Delete wrapper on remove — .specs/features/005-wrapper-script-generation/spec.md#fr-043
	const wrapperService = new WrapperService(getDataDir());
	await wrapperService.remove(name);

	console.log(formatSuccess(`Task ${name} removed`));

	if (!values["no-sync"]) {
		await autoSync(repo);
	}
}

/**
 * Enrich a single task with last execution and next run data.
 * @param task The raw task from the manifest
 * @returns Enriched task with lastRun, lastExitCode, nextRun
 */
async function enrichTask(task: Task): Promise<EnrichedTask> {
	const lastExec = await getLastExecution(task.name);
	const nextRun = getNextExecution(task.schedule);

	return {
		...task,
		lastRun: lastExec?.timestamp ?? null,
		lastExitCode: lastExec?.exitCode ?? null,
		nextRun: nextRun.toISOString(),
	};
}

/**
 * Enrich an array of tasks with last execution and next run data.
 * @param tasks Array of raw tasks from the manifest
 * @returns Array of enriched tasks
 */
async function enrichTasks(tasks: Task[]): Promise<EnrichedTask[]> {
	return Promise.all(tasks.map((task) => enrichTask(task)));
}

// @spec FR-003: History handler, FR-006: Command registration, FR-008: --limit flag, FR-009: Task validation, FR-010: No history message — .specs/features/007-execution-history/spec.md#fr-003
/** Default number of history entries to display. */
const DEFAULT_HISTORY_LIMIT = 10;

async function handleHistory(args: string[], service: TaskService): Promise<void> {
	const name = args[0];
	if (!name) {
		console.error(formatError("Missing task name", "Usage: cronshed history <name> [--limit N] [--json]"));
		process.exit(2);
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
	if (isNaN(limit) || limit < 0) {
		console.error(formatError("Invalid --limit value", "Must be a non-negative integer"));
		process.exit(2);
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
	const reversed = entries.reverse();
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

const QUERY_SUBCOMMANDS: Record<string, (args: string[], service: TaskService) => Promise<void>> = {
	list: handleList,
	get: handleGet,
	history: handleHistory,
};

const MUTATION_SUBCOMMANDS: Record<string, (args: string[], service: TaskService, repo: TaskRepository) => Promise<void>> = {
	add: handleAdd,
	update: handleUpdate,
	remove: handleRemove,
};

/** Commands that manage their own dependencies (no shared TaskService). */
const STANDALONE_COMMANDS: Record<string, (args: string[]) => Promise<void>> = {
	sync: handleSync,
};

/**
 * Main CLI entry point. Parses subcommand from argv and dispatches to the appropriate handler.
 * Catches all domain errors, formats them to stderr, and exits with mapped status codes.
 * @param argv Process argument vector (typically process.argv)
 */
export async function runCli(argv: string[]): Promise<void> {
	const subcommand = argv[2];
	const args = argv.slice(3);

	if (!subcommand || subcommand === "--help" || subcommand === "-h") {
		console.log("Usage: cronshed <command> [options]");
		console.log("");
		console.log("Commands:");
		console.log("  add <name> --schedule '<cron>' --command '<cmd>' [--no-sync]   Add a task");
		console.log("  list [--json]                                                  List all tasks");
		console.log("  get <name> [--json]                                            Show task details");
		console.log("  update <name> [--schedule '<cron>'] [--command '<cmd>'] [--no-sync]  Update a task");
		console.log("  remove <name> [--no-sync]                                     Remove a task");
		console.log("  history <name> [--limit N] [--json]                            Show execution history");
		console.log("  sync [--dry-run] [--clear]                                    Sync tasks to crontab");
		return;
	}

	// Standalone commands (manage their own dependencies)
	const standalone = STANDALONE_COMMANDS[subcommand];
	if (standalone) {
		try {
			await standalone(args);
		} catch (err) {
			const code = getExitCode(err);
			const hint = getErrorHint(err);
			const message = err instanceof Error ? err.message : String(err);
			console.error(formatError(message, hint));
			process.exit(code);
		}
		return;
	}

	const mutationHandler = MUTATION_SUBCOMMANDS[subcommand];
	const queryHandler = QUERY_SUBCOMMANDS[subcommand];

	if (!mutationHandler && !queryHandler) {
		console.error(formatError(`Unknown command "${subcommand}"`, "Run 'cronshed --help' for usage"));
		process.exit(2);
	}

	const repo = new TaskRepository();
	const service = new TaskService(repo);

	try {
		if (mutationHandler) {
			await mutationHandler(args, service, repo);
		} else {
			await queryHandler!(args, service);
		}
	} catch (err) {
		const code = getExitCode(err);
		const hint = getErrorHint(err);
		const message = err instanceof Error ? err.message : String(err);
		console.error(formatError(message, hint));
		process.exit(code);
	}
}
