// @spec FR-005: Subcommand routing, FR-008: Error handling — .specs/features/001-task-manifest/spec.md#fr-005
//
// Main CLI entry point. Dispatches subcommands to focused handler modules:
//   - handlers/task-crud.handler.ts — add, update, remove, pause, resume
//   - handlers/task-query.handler.ts — list, get, history, tags
//   - handlers/ops.handler.ts       — sync, doctor, import, rotate, run

import { InvalidConfigKeyError, InvalidConfigValueError } from "../config/config.service";
import { InvalidCronExpressionError } from "../cron/cron.errors";
import { CrontabReadError, CrontabWriteError } from "../crontab/crontab.errors";
import {
	DuplicateTaskNameError,
	EmptyCommandError,
	InvalidTagError,
	InvalidTaskNameError,
	ManifestAccessError,
	ManifestCorruptedError,
	ManifestVersionError,
	NoChangesSpecifiedError,
	TaskAlreadyActiveError,
	TaskAlreadyPausedError,
	TaskNotFoundError,
} from "../task/task.errors";
import { TaskRepository } from "../task/task.repository";
import { TaskService } from "../task/task.service";
import { TimeoutToolMissingError, WrapperGenerationError } from "../wrapper/wrapper.errors";
import { CommandFileNotExecutableError, CommandFileNotFoundError, CommandPathIsDirectoryError } from "./command.errors";
import { formatError } from "./formatters/base.formatter";
import { handleConfig } from "./handlers/config.handler";
import { handleDoctor, handleImport, handleRotate, handleRun, handleSync } from "./handlers/ops.handler";
import { handleAdd, handlePause, handleRemove, handleResume, handleUpdate } from "./handlers/task-crud.handler";
import { handleGet, handleHistory, handleList, handleTags } from "./handlers/task-query.handler";

// @spec FR-008: Map domain errors to exit codes — .specs/features/001-task-manifest/spec.md#fr-008
function getExitCode(err: unknown): number {
	if (
		err instanceof InvalidCronExpressionError ||
		err instanceof InvalidTaskNameError ||
		err instanceof EmptyCommandError ||
		err instanceof InvalidTagError ||
		err instanceof CommandFileNotFoundError ||
		err instanceof CommandFileNotExecutableError ||
		err instanceof CommandPathIsDirectoryError ||
		err instanceof NoChangesSpecifiedError ||
		err instanceof TimeoutToolMissingError ||
		err instanceof InvalidConfigKeyError ||
		err instanceof InvalidConfigValueError
	) {
		return 2;
	}
	if (
		err instanceof ManifestCorruptedError ||
		err instanceof ManifestVersionError ||
		err instanceof ManifestAccessError ||
		err instanceof CrontabReadError ||
		err instanceof CrontabWriteError ||
		err instanceof WrapperGenerationError
	) {
		return 3;
	}
	if (
		err instanceof TaskNotFoundError ||
		err instanceof DuplicateTaskNameError ||
		err instanceof TaskAlreadyPausedError ||
		err instanceof TaskAlreadyActiveError
	) {
		return 1;
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
	if (err instanceof TimeoutToolMissingError) {
		return undefined; // Message already includes install instructions
	}
	return undefined;
}

const QUERY_SUBCOMMANDS: Record<string, (args: string[], service: TaskService) => Promise<void>> = {
	list: handleList,
	get: handleGet,
	history: handleHistory,
	tags: handleTags,
};

const MUTATION_SUBCOMMANDS: Record<
	string,
	(args: string[], service: TaskService, repo: TaskRepository) => Promise<void>
> = {
	add: handleAdd,
	update: handleUpdate,
	remove: handleRemove,
	pause: handlePause,
	resume: handleResume,
};

/** Commands that manage their own dependencies (no shared TaskService). */
// @spec FR-010: Register run command — .specs/features/014-dry-run-mode/spec.md#fr-010
// @spec FR-093: Register config command — .specs/features/015-wrapper-protections/spec.md#fr-093
const STANDALONE_COMMANDS: Record<string, (args: string[]) => Promise<void>> = {
	sync: handleSync,
	doctor: handleDoctor,
	import: handleImport,
	rotate: handleRotate,
	run: handleRun,
	config: handleConfig,
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
		// @spec FR-088: Help text for protection flags — .specs/features/015-wrapper-protections/spec.md#fr-088
		console.log("  add <name> --schedule '<cron>' --command '<cmd>' [--notify] [--tag <tag>]...");
		console.log(
			"      [--allow-parallel] [--timeout <duration>] [--no-sync]                                    Add a task",
		);
		console.log(
			"  list [--tag <tag>] [--json]                                                                  List all tasks",
		);
		console.log(
			"  get <name> [--json]                                                                          Show task details",
		);
		console.log("  update <name> [--schedule] [--command] [--notify|--no-notify] [--tag]... [--untag]...");
		console.log(
			"      [--allow-parallel|--no-allow-parallel] [--timeout <duration>] [--no-sync]                Update a task",
		);
		console.log(
			"  remove <name> [--no-sync]                                                                    Remove a task",
		);
		// @spec FR-062: Help text for pause/resume — .specs/features/009-task-pause-resume/spec.md#fr-062
		console.log(
			"  pause <name> [--no-sync]                                                                     Pause a task",
		);
		console.log(
			"  resume <name> [--no-sync]                                                                    Resume a paused task",
		);
		console.log(
			"  history <name> [--limit N] [--json]                                                          Show execution history",
		);
		console.log(
			"  tags [--json]                                                                                 List all tags",
		);
		console.log(
			"  sync [--dry-run] [--clear]                                                                    Sync tasks to crontab",
		);
		// @spec FR-073: Help text for doctor — .specs/features/010-task-diagnosis/spec.md#fr-073
		console.log(
			"  doctor [name] [--json]                                                                        Diagnose task issues",
		);
		console.log(
			"  import [--dry-run] [--prefix <name>]                                                          Import crontab entries",
		);
		console.log(
			"  rotate [name] [--max-age <days>] [--max-entries <N>] [--dry-run] [--json]                     Rotate execution logs",
		);
		console.log(
			"  run <name> [--json]                                                                           Run a task immediately",
		);
		// @spec FR-093: Help text for config command — .specs/features/015-wrapper-protections/spec.md#fr-093
		console.log(
			"  config set <key> <value>                                                                      Set a config value",
		);
		console.log(
			"  config get <key>                                                                              Get a config value",
		);
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
			await queryHandler?.(args, service);
		}
	} catch (err) {
		const code = getExitCode(err);
		const hint = getErrorHint(err);
		const message = err instanceof Error ? err.message : String(err);
		console.error(formatError(message, hint));
		process.exit(code);
	}
}
