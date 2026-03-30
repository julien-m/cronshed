// @spec FR-005: Subcommand routing, FR-008: Error handling — .specs/features/001-task-manifest/spec.md#fr-005

import { parseArgs } from "node:util";
import { TaskService } from "../task/task.service";
import { TaskRepository } from "../task/task.repository";
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
import { formatTaskTable, formatTaskDetails, formatSuccess, formatError } from "./cli.formatter";

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
	if (err instanceof ManifestCorruptedError || err instanceof ManifestVersionError || err instanceof ManifestAccessError) {
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
	if (err instanceof CommandFileNotFoundError) {
		return `Resolved to: ${err.resolved}`;
	}
	if (err instanceof CommandFileNotExecutableError) {
		return `Run: chmod +x ${err.resolved}`;
	}
	if (err instanceof CommandPathIsDirectoryError) {
		return "Expected a file, not a directory";
	}
	return undefined;
}

async function handleAdd(args: string[], service: TaskService): Promise<void> {
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

	if (resolution.isFilePath) {
		console.log(formatSuccess(`Task ${task.name} created (command: ${resolution.resolved})`));
	} else {
		console.log(formatSuccess(`Task ${task.name} created`));
	}
}

async function handleList(args: string[], service: TaskService): Promise<void> {
	const { values } = parseArgs({
		args,
		options: {
			json: { type: "boolean", default: false },
		},
		allowPositionals: false,
	});

	let tasks;
	try {
		tasks = await service.list();
	} catch (err) {
		// If manifest doesn't exist, list returns empty
		throw err;
	}

	if (values.json) {
		console.log(JSON.stringify(tasks, null, "\t"));
		return;
	}

	if (tasks.length === 0) {
		// Check if manifest file exists to give contextual message
		console.log("No tasks configured. Run 'cronshed add' to create your first task.");
		return;
	}

	console.log(formatTaskTable(tasks));
}

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

	if (values.json) {
		console.log(JSON.stringify(task, null, "\t"));
		return;
	}

	console.log(formatTaskDetails(task));
}

async function handleUpdate(args: string[], service: TaskService): Promise<void> {
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
	console.log(formatSuccess(`Task ${task.name} updated`));
}

async function handleRemove(args: string[], service: TaskService): Promise<void> {
	const name = args[0];
	if (!name) {
		console.error(formatError("Missing task name", "Usage: cronshed remove <name>"));
		process.exit(2);
	}

	await service.remove(name);
	console.log(formatSuccess(`Task ${name} removed`));
}

const SUBCOMMANDS: Record<string, (args: string[], service: TaskService) => Promise<void>> = {
	add: handleAdd,
	list: handleList,
	get: handleGet,
	update: handleUpdate,
	remove: handleRemove,
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
		console.log("  add <name> --schedule '<cron>' --command '<cmd>'   Add a task");
		console.log("  list [--json]                                      List all tasks");
		console.log("  get <name> [--json]                                Show task details");
		console.log("  update <name> [--schedule '<cron>'] [--command '<cmd>']  Update a task");
		console.log("  remove <name>                                      Remove a task");
		return;
	}

	const handler = SUBCOMMANDS[subcommand];
	if (!handler) {
		console.error(formatError(`Unknown command "${subcommand}"`, "Run 'cronshed --help' for usage"));
		process.exit(2);
	}

	const repo = new TaskRepository();
	const service = new TaskService(repo);

	try {
		await handler(args, service);
	} catch (err) {
		const code = getExitCode(err);
		const hint = getErrorHint(err);
		const message = err instanceof Error ? err.message : String(err);
		console.error(formatError(message, hint));
		process.exit(code);
	}
}
