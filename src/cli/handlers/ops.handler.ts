// Operational command handlers: sync, doctor, import, rotate, run.
// @spec FR-022: Sync handler — .specs/features/003-crontab-sync/spec.md#fr-022
// @spec FR-069: Doctor handler — .specs/features/010-task-diagnosis/spec.md#fr-069
// @spec FR-079: Import handler — .specs/features/011-import-existing-crontab/spec.md#fr-079
// @spec FR-005: Rotate handler — .specs/features/012-log-rotation/spec.md#fr-005
// @spec FR-001: Run handler — .specs/features/014-dry-run-mode/spec.md#fr-001

import { parseArgs } from "node:util";
import { getDataDir, getLogPath } from "../../app/config";
import { CrontabAdapter } from "../../crontab/crontab.adapter";
import { SyncService } from "../../crontab/sync.service";
import { DiagnosisService } from "../../diagnosis/diagnosis.service";
import type { DiagnosisResult } from "../../diagnosis/diagnosis.types";
import { importCrontabEntries } from "../../import/import.service";
import { DEFAULT_MAX_AGE_DAYS, DEFAULT_MAX_ENTRIES, rotateAllLogs, rotateLogFile } from "../../log/rotation.service";
import type { RotationResult } from "../../log/rotation.service";
import { TaskRepository } from "../../task/task.repository";
import { TaskService } from "../../task/task.service";
import { WrapperService } from "../../wrapper/wrapper.service";
import { formatError, formatSuccess } from "../formatters/base.formatter";
import {
	formatDiagnosisReport,
	formatImportPreview,
	formatImportSummary,
	formatRotationSummary,
	formatRunSummary,
	formatSkippedWarning,
	formatSyncDiff,
	formatSyncResult,
} from "../formatters/ops.formatter";
import { autoSync } from "./shared";

// @spec FR-022: Sync handler, FR-024: Dry-run display, FR-027: Error handling — .specs/features/003-crontab-sync/spec.md#fr-022
export async function handleSync(args: string[]): Promise<void> {
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

// @spec FR-069: Doctor CLI handler, FR-071: Exit codes, FR-072: JSON output — .specs/features/010-task-diagnosis/spec.md#fr-069
export async function handleDoctor(args: string[]): Promise<void> {
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

	let results: DiagnosisResult[];
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
export async function handleImport(args: string[]): Promise<void> {
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
export async function handleRotate(args: string[]): Promise<void> {
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
	if (Number.isNaN(maxAgeDays) || maxAgeDays < 0) {
		console.error(formatError("Invalid --max-age value", "Must be a non-negative integer"));
		process.exit(2);
		return;
	}

	const maxEntries = values["max-entries"] !== undefined ? parseInt(values["max-entries"], 10) : DEFAULT_MAX_ENTRIES;
	if (Number.isNaN(maxEntries) || maxEntries < 0) {
		console.error(formatError("Invalid --max-entries value", "Must be a non-negative integer"));
		process.exit(2);
		return;
	}

	const options = {
		maxAgeDays,
		maxEntries,
		dryRun: values["dry-run"] ?? false,
	};

	const repo = new TaskRepository();
	const taskService = new TaskService(repo);

	let results: Array<RotationResult>;
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

// @spec FR-001: Run handler, FR-002: Task lookup, FR-003: Wrapper auto-gen, FR-004: Output streaming, FR-005: Exit code capture, FR-007: JSON output, FR-008: Exit code propagation, FR-009: Usage error, FR-011: Delegates logging to wrapper — .specs/features/014-dry-run-mode/spec.md#fr-001
export async function handleRun(args: string[]): Promise<void> {
	const name = args[0] && !args[0].startsWith("--") ? args[0] : undefined;
	const restArgs = name ? args.slice(1) : args;

	if (!name) {
		console.error(formatError("Missing task name", "Usage: cronshed run <name> [--json]"));
		process.exit(2);
		return;
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
		console.log(
			JSON.stringify(
				{
					taskName: task.name,
					exitCode,
					durationMs,
				},
				null,
				"\t",
			),
		);
	} else {
		console.log(formatRunSummary(task.name, exitCode, durationMs));
	}

	process.exit(exitCode);
}
