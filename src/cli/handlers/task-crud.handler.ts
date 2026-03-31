// Mutation handlers: add, update, remove, pause, resume.
// @spec FR-029, FR-030, FR-031, FR-032, FR-033, FR-034: Mutation auto-sync — .specs/features/004-auto-sync/spec.md#fr-029

import { parseArgs } from "node:util";
import { TaskService } from "../../task/task.service";
import { TaskRepository } from "../../task/task.repository";
import { WrapperService } from "../../wrapper/wrapper.service";
import { resolveCommand } from "../command.resolver";
import { getDataDir } from "../../app/config";
import { formatSuccess, formatError } from "../formatters/base.formatter";
import { autoSync } from "./shared";

// @spec FR-029, FR-034: Auto-sync on add with --no-sync flag — .specs/features/004-auto-sync/spec.md#fr-029
export async function handleAdd(args: string[], service: TaskService, repo: TaskRepository): Promise<void> {
	const name = args[0];
	if (!name) {
		console.error(formatError("Missing task name", "Usage: cronshed add <name> --schedule '<cron>' --command '<cmd>'"));
		process.exit(2);
		return;
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

// @spec FR-031, FR-034: Auto-sync on update with --no-sync flag — .specs/features/004-auto-sync/spec.md#fr-031
export async function handleUpdate(args: string[], service: TaskService, repo: TaskRepository): Promise<void> {
	const name = args[0];
	if (!name) {
		console.error(formatError("Missing task name", "Usage: cronshed update <name> --schedule '<cron>' --command '<cmd>'"));
		process.exit(2);
		return;
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
export async function handleRemove(args: string[], service: TaskService, repo: TaskRepository): Promise<void> {
	const name = args[0];
	if (!name) {
		console.error(formatError("Missing task name", "Usage: cronshed remove <name>"));
		process.exit(2);
		return;
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
export async function handlePause(args: string[], service: TaskService, repo: TaskRepository): Promise<void> {
	const name = args[0];
	if (!name) {
		console.error(formatError("Missing task name", "Usage: cronshed pause <name> [--no-sync]"));
		process.exit(2);
		return;
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
export async function handleResume(args: string[], service: TaskService, repo: TaskRepository): Promise<void> {
	const name = args[0];
	if (!name) {
		console.error(formatError("Missing task name", "Usage: cronshed resume <name> [--no-sync]"));
		process.exit(2);
		return;
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
