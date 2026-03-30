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
	TaskAlreadyPausedError,
	TaskAlreadyActiveError,
	InvalidTagError,
} from "../task/task.errors";
import { resolveCommand } from "./command.resolver";
import {
	CommandFileNotFoundError,
	CommandFileNotExecutableError,
	CommandPathIsDirectoryError,
} from "./command.errors";
import { WrapperService } from "../wrapper/wrapper.service";
import { WrapperGenerationError } from "../wrapper/wrapper.errors";
import { getDataDir, getLogPath } from "../app/config";
import { getNextExecution } from "../cron/cron.service";
import { getLastExecution } from "../log/log.service";
import type { Task, EnrichedTask } from "../task/task.types";
import { TASK_STATUS } from "../task/task.types";
import { formatTaskTable, formatTaskDetails, formatHistoryTable, formatSuccess, formatError, formatWarning, formatSyncConfirmation, formatSyncResult, formatSyncDiff, formatDiagnosisReport, formatImportPreview, formatImportSummary, formatSkippedWarning, formatRotationSummary, formatTagsTable, formatRunSummary } from "./cli.formatter";
import { importCrontabEntries } from "../import/import.service";
import { getExecutionHistory } from "../log/log.service";
import { DiagnosisService } from "../diagnosis/diagnosis.service";
import { rotateLogFile, rotateAllLogs, DEFAULT_MAX_AGE_DAYS, DEFAULT_MAX_ENTRIES } from "../log/rotation.service";

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
		err instanceof InvalidTagError ||
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
	if (
		err instanceof TaskNotFoundError || err instanceof DuplicateTaskNameError ||
		err instanceof TaskAlreadyPausedError || err instanceof TaskAlreadyActiveError
	) {
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
	if (err instanceof InvalidTagError) {
		return "Tags must be lowercase kebab-case (e.g., 'backup', 'db-sync')";
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

	// @spec FR-009: Parse --tag flags on add — .specs/features/013-task-groups-tags/spec.md#fr-009
	const { values } = parseArgs({
		args: args.slice(1),
		options: {
			schedule: { type: "string", short: "s" },
			command: { type: "string", short: "c" },
			notify: { type: "boolean", default: false },
			tag: { type: "string", multiple: true },
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

	// @spec FR-051: Pass notify flag to task creation — .specs/features/008-failure-notifications/spec.md#fr-051
	const task = await service.add({
		name,
		schedule: values.schedule,
		command: resolution.resolved,
		notify: values.notify ?? false,
		tags: values.tag,
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
// @spec FR-011: List filter by tag — .specs/features/013-task-groups-tags/spec.md#fr-011
async function handleList(args: string[], service: TaskService): Promise<void> {
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

	// @spec FR-052: Accept --notify and --no-notify flags — .specs/features/008-failure-notifications/spec.md#fr-052
	// @spec FR-010: Parse --tag and --untag flags on update — .specs/features/013-task-groups-tags/spec.md#fr-010
	const { values } = parseArgs({
		args: args.slice(1),
		options: {
			schedule: { type: "string", short: "s" },
			command: { type: "string", short: "c" },
			notify: { type: "boolean" },
			"no-notify": { type: "boolean" },
			tag: { type: "string", multiple: true },
			untag: { type: "string", multiple: true },
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

	// Resolve notify: --notify wins over --no-notify, undefined if neither
	const notifyValue = values.notify === true ? true : values["no-notify"] === true ? false : undefined;

	const task = await service.update(name, {
		schedule: values.schedule,
		command: resolvedCommand,
		notify: notifyValue,
		tags: values.tag,
		untags: values.untag,
	});

	// @spec FR-042: Regenerate wrapper on command or notify change — .specs/features/005-wrapper-script-generation/spec.md#fr-042
	// @spec FR-052: Regenerate wrapper when notify changes — .specs/features/008-failure-notifications/spec.md#fr-052
	if (values.command || notifyValue !== undefined) {
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

// @spec FR-058: Pause handler with --no-sync and auto-sync — .specs/features/009-task-pause-resume/spec.md#fr-058
async function handlePause(args: string[], service: TaskService, repo: TaskRepository): Promise<void> {
	const name = args[0];
	if (!name) {
		console.error(formatError("Missing task name", "Usage: cronshed pause <name> [--no-sync]"));
		process.exit(2);
	}

	const { values } = parseArgs({
		args: args.slice(1),
		options: {
			"no-sync": { type: "boolean", default: false },
		},
		allowPositionals: false,
	});

	await service.pause(name);
	console.log(formatSuccess(`Task ${name} paused`));

	if (!values["no-sync"]) {
		await autoSync(repo);
	}
}

// @spec FR-058: Resume handler with --no-sync and auto-sync — .specs/features/009-task-pause-resume/spec.md#fr-058
async function handleResume(args: string[], service: TaskService, repo: TaskRepository): Promise<void> {
	const name = args[0];
	if (!name) {
		console.error(formatError("Missing task name", "Usage: cronshed resume <name> [--no-sync]"));
		process.exit(2);
	}

	const { values } = parseArgs({
		args: args.slice(1),
		options: {
			"no-sync": { type: "boolean", default: false },
		},
		allowPositionals: false,
	});

	await service.resume(name);
	console.log(formatSuccess(`Task ${name} resumed`));

	if (!values["no-sync"]) {
		await autoSync(repo);
	}
}

/**
 * Enrich a single task with last execution and next run data.
 * Paused tasks show "--" for nextRun since they will not execute.
 * @param task The raw task from the manifest
 * @returns Enriched task with lastRun, lastExitCode, nextRun
 */
// @spec FR-060: Paused tasks show "--" for nextRun — .specs/features/009-task-pause-resume/spec.md#fr-060
async function enrichTask(task: Task): Promise<EnrichedTask> {
	const lastExec = await getLastExecution(task.name);
	const nextRun = task.status === TASK_STATUS.PAUSED
		? "\u2014"
		: getNextExecution(task.schedule).toISOString();

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

// @spec FR-069: Doctor CLI handler, FR-071: Exit codes, FR-072: JSON output — .specs/features/010-task-diagnosis/spec.md#fr-069
async function handleDoctor(args: string[]): Promise<void> {
	// Parse optional task name and --json flag
	// The name is the first positional arg (if it doesn't start with --)
	const name = args[0] && !args[0].startsWith("--") ? args[0] : undefined;
	const restArgs = name ? args.slice(1) : args;

	const { values } = parseArgs({
		args: restArgs,
		options: {
			json: { type: "boolean", default: false },
		},
		allowPositionals: false,
	});

	const repo = new TaskRepository();
	const adapter = new CrontabAdapter();
	const wrapperService = new WrapperService(getDataDir());
	const diagnosisService = new DiagnosisService(repo, adapter, wrapperService, getDataDir());
	const taskService = new TaskService(repo);

	let results;
	if (name) {
		// Validate task exists
		const task = await taskService.get(name);
		const result = await diagnosisService.diagnose(task);
		results = [result];
	} else {
		results = await diagnosisService.diagnoseAll();
	}

	if (results.length === 0) {
		if (values.json) {
			console.log(JSON.stringify([], null, "\t"));
		} else {
			console.log("No tasks configured. Run 'cronshed add' to create your first task.");
		}
		return;
	}

	if (values.json) {
		console.log(JSON.stringify(results, null, "\t"));
	} else {
		console.log(formatDiagnosisReport(results));
	}

	// Exit 1 if any issues found
	const hasIssues = results.some((r) => r.status === "issues");
	if (hasIssues) {
		process.exit(1);
	}
}

// @spec FR-079: Import CLI handler, FR-081: Create tasks, FR-082: Auto-sync after import — .specs/features/011-import-existing-crontab/spec.md#fr-079
async function handleImport(args: string[]): Promise<void> {
	const { values } = parseArgs({
		args,
		options: {
			"dry-run": { type: "boolean", default: false },
			prefix: { type: "string" },
		},
		allowPositionals: false,
	});

	const adapter = new CrontabAdapter();
	const repo = new TaskRepository();
	const taskService = new TaskService(repo);

	// Read crontab
	const crontab = await adapter.read();

	// Get existing task names for conflict resolution
	const existingTasks = await taskService.list();
	const existingNames = new Set(existingTasks.map((t) => t.name));

	// Run import logic
	const result = importCrontabEntries(crontab.userLines, existingNames, {
		dryRun: values["dry-run"] ?? false,
		prefix: values.prefix,
	});

	// Show warnings for skipped entries
	for (const skipped of result.skipped) {
		console.error(formatSkippedWarning(skipped));
	}

	// Handle empty result
	if (result.imported.length === 0) {
		console.log("No entries to import");
		return;
	}

	// Dry-run: show preview only
	if (result.dryRun) {
		console.log(formatImportPreview(result.imported));
		console.log("");
		console.log(formatImportSummary(result));
		return;
	}

	// Create tasks and generate wrappers
	const wrapperService = new WrapperService(getDataDir());
	for (const entry of result.imported) {
		const task = await taskService.add({
			name: entry.name,
			schedule: entry.schedule,
			command: entry.command,
		});
		await wrapperService.generate(task);
	}

	// Display summary
	console.log(formatImportSummary(result));

	// Auto-sync
	await autoSync(repo);
}

// @spec FR-005: Rotate CLI handler, FR-006: Command registration — .specs/features/012-log-rotation/spec.md#fr-005
async function handleRotate(args: string[]): Promise<void> {
	// Parse optional task name (first positional arg, if not a flag)
	const name = args[0] && !args[0].startsWith("--") ? args[0] : undefined;
	const restArgs = name ? args.slice(1) : args;

	const { values } = parseArgs({
		args: restArgs,
		options: {
			"max-age": { type: "string" },
			"max-entries": { type: "string" },
			"dry-run": { type: "boolean", default: false },
			json: { type: "boolean", default: false },
		},
		allowPositionals: false,
	});

	const maxAgeDays = values["max-age"] !== undefined ? parseInt(values["max-age"], 10) : DEFAULT_MAX_AGE_DAYS;
	if (isNaN(maxAgeDays) || maxAgeDays < 0) {
		console.error(formatError("Invalid --max-age value", "Must be a non-negative integer"));
		process.exit(2);
	}

	const maxEntries = values["max-entries"] !== undefined ? parseInt(values["max-entries"], 10) : DEFAULT_MAX_ENTRIES;
	if (isNaN(maxEntries) || maxEntries < 0) {
		console.error(formatError("Invalid --max-entries value", "Must be a non-negative integer"));
		process.exit(2);
	}

	const options = {
		maxAgeDays,
		maxEntries,
		dryRun: values["dry-run"] ?? false,
	};

	const repo = new TaskRepository();
	const taskService = new TaskService(repo);

	let results;
	if (name) {
		// Validate task exists
		const task = await taskService.get(name);
		const logPath = getLogPath(task.name);
		const result = await rotateLogFile(task.name, logPath, options);
		results = [result];
	} else {
		const tasks = await taskService.list();
		results = await rotateAllLogs(tasks, options);
	}

	if (values.json) {
		const totalRemoved = results.reduce((sum, r) => sum + r.entriesRemoved, 0);
		console.log(JSON.stringify({ tasks: results, totalRemoved }, null, "\t"));
		return;
	}

	console.log(formatRotationSummary(results, options.dryRun));
}

// @spec FR-012: Tags subcommand — .specs/features/013-task-groups-tags/spec.md#fr-012
async function handleTags(args: string[], service: TaskService): Promise<void> {
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

// @spec FR-001: Run command handler — .specs/features/014-dry-run-mode/spec.md#fr-001
// @spec FR-002: Task lookup — .specs/features/014-dry-run-mode/spec.md#fr-002
// @spec FR-003: Wrapper auto-generation — .specs/features/014-dry-run-mode/spec.md#fr-003
// @spec FR-004: Real-time output streaming — .specs/features/014-dry-run-mode/spec.md#fr-004
// @spec FR-005: Exit code and duration capture — .specs/features/014-dry-run-mode/spec.md#fr-005
// @spec FR-007: JSON output mode — .specs/features/014-dry-run-mode/spec.md#fr-007
// @spec FR-008: Exit code propagation — .specs/features/014-dry-run-mode/spec.md#fr-008
// @spec FR-009: Usage error — .specs/features/014-dry-run-mode/spec.md#fr-009
async function handleRun(args: string[]): Promise<void> {
	const name = args[0] && !args[0].startsWith("--") ? args[0] : undefined;
	const restArgs = name ? args.slice(1) : args;

	if (!name) {
		console.error(formatError("Missing task name", "Usage: cronshed run <name> [--json]"));
		process.exit(2);
	}

	const { values } = parseArgs({
		args: restArgs,
		options: {
			json: { type: "boolean", default: false },
		},
		allowPositionals: false,
	});

	const repo = new TaskRepository();
	const service = new TaskService(repo);
	const wrapperService = new WrapperService(getDataDir());

	// Lookup task (throws TaskNotFoundError if missing)
	const task = await service.get(name);

	// Ensure wrapper exists, generate if missing
	const wrapperPath = wrapperService.getWrapperPath(task.name);
	const wrapperExists = await Bun.file(wrapperPath).exists();

	if (!wrapperExists) {
		await wrapperService.generate(task);
		console.error(formatSuccess(`Wrapper generated for ${task.name}`));
	}

	// Spawn wrapper with inherited stdio for real-time streaming
	const startTime = Date.now();
	const proc = Bun.spawn([wrapperPath], {
		stdout: "inherit",
		stderr: "inherit",
		env: { ...process.env },
	});

	const exitCode = await proc.exited;
	const durationMs = Date.now() - startTime;

	// Output summary
	if (values.json) {
		console.log(JSON.stringify({
			taskName: task.name,
			exitCode,
			durationMs,
		}, null, "\t"));
	} else {
		console.log(formatRunSummary(task.name, exitCode, durationMs));
	}

	process.exit(exitCode);
}

const QUERY_SUBCOMMANDS: Record<string, (args: string[], service: TaskService) => Promise<void>> = {
	list: handleList,
	get: handleGet,
	history: handleHistory,
	tags: handleTags,
};

const MUTATION_SUBCOMMANDS: Record<string, (args: string[], service: TaskService, repo: TaskRepository) => Promise<void>> = {
	add: handleAdd,
	update: handleUpdate,
	remove: handleRemove,
	pause: handlePause,
	resume: handleResume,
};

/** Commands that manage their own dependencies (no shared TaskService). */
// @spec FR-010: Register run command — .specs/features/014-dry-run-mode/spec.md#fr-010
const STANDALONE_COMMANDS: Record<string, (args: string[]) => Promise<void>> = {
	sync: handleSync,
	doctor: handleDoctor,
	import: handleImport,
	rotate: handleRotate,
	run: handleRun,
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
		// @spec FR-015: Help text with tag flags — .specs/features/013-task-groups-tags/spec.md#fr-015
		console.log("  add <name> --schedule '<cron>' --command '<cmd>' [--notify] [--tag <tag>]... [--no-sync]   Add a task");
		console.log("  list [--tag <tag>] [--json]                                   List all tasks (optionally filter by tag)");
		console.log("  get <name> [--json]                                            Show task details");
		console.log("  update <name> [--schedule '<cron>'] [--command '<cmd>'] [--notify|--no-notify] [--tag <tag>]... [--untag <tag>]... [--no-sync]  Update a task");
		console.log("  remove <name> [--no-sync]                                     Remove a task");
		console.log("  pause <name> [--no-sync]                                      Pause a task (remove from crontab)");
		console.log("  resume <name> [--no-sync]                                     Resume a paused task");
		console.log("  history <name> [--limit N] [--json]                            Show execution history");
		console.log("  tags [--json]                                                  List all tags with task counts");
		console.log("  sync [--dry-run] [--clear]                                    Sync tasks to crontab");
		console.log("  doctor [name] [--json]                                         Diagnose task issues");
		console.log("  import [--dry-run] [--prefix <name>]                              Import crontab entries");
		console.log("  rotate [name] [--max-age <days>] [--max-entries <N>] [--dry-run] [--json]  Rotate execution logs");
		console.log("  run <name> [--json]                                            Run a task immediately");
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
