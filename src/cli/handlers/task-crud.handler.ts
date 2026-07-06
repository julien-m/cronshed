// Mutation handlers: add, update, remove, pause, resume.
// @spec FR-029, FR-030, FR-031, FR-032, FR-033, FR-034: Mutation auto-sync — .specs/features/004-auto-sync/spec.md#fr-029
// @spec FR-088: Protection flags on add/update — .specs/features/015-wrapper-protections/spec.md#fr-088

import { parseArgs } from "node:util";
import { getDataDir, getTasksPath } from "../../app/config";
import { ConfigRepository } from "../../config/config.repository";
import { ConfigService } from "../../config/config.service";
import { scheduleToIntervalSeconds } from "../../cron/schedule-interval";
import type { TaskRepository } from "../../task/task.repository";
import type { TaskService } from "../../task/task.service";
import { parseDuration } from "../../wrapper/duration";
import { computeTimeoutFromRatio, detectTimeoutTool, WrapperService } from "../../wrapper/wrapper.service";
import { resolveCommand } from "../command.resolver";
import { formatError, formatSuccess, formatWarning } from "../formatters/base.formatter";
import { autoSync } from "./shared";

/** Whether a ratio is configured, without computing or persisting a derived timeout. */
async function hasDefaultTimeoutRatio(): Promise<boolean> {
	const configRepo = new ConfigRepository();
	const configService = new ConfigService(configRepo);
	const ratioStr = await configService.get("default-timeout-ratio");
	return ratioStr !== undefined;
}

async function computeConfiguredRatioTimeout(schedule: string): Promise<number | undefined> {
	const configRepo = new ConfigRepository();
	return computeTimeoutFromRatio(schedule, configRepo.getPath());
}

// @spec FR-029, FR-034: Auto-sync on add with --no-sync flag — .specs/features/004-auto-sync/spec.md#fr-029
// @spec FR-088: Parse --allow-parallel and --timeout — .specs/features/015-wrapper-protections/spec.md#fr-088
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
			"allow-parallel": { type: "boolean", default: false },
			timeout: { type: "string" },
		},
		allowPositionals: false,
	});

	if (!values.schedule) {
		console.error(
			formatError("Missing --schedule flag", "Usage: cronshed add <name> --schedule '<cron>' --command '<cmd>'"),
		);
		process.exit(2);
	}
	if (!values.command) {
		console.error(
			formatError("Missing --command flag", "Usage: cronshed add <name> --schedule '<cron>' --command '<cmd>'"),
		);
		process.exit(2);
	}
	const schedule = values.schedule;
	const command = values.command;

	// Validate timeout format if provided
	if (values.timeout) {
		parseDuration(values.timeout); // throws on invalid format
	}

	// @spec FR-016: Include resolved path in success message — .specs/features/002-command-path-resolution/spec.md#fr-016
	const resolution = await resolveCommand(command);

	if (values.timeout) {
		parseDuration(values.timeout);
	}

	const ratioTimeoutSeconds = values.timeout ? undefined : await computeConfiguredRatioTimeout(schedule);
	if (values.timeout || ratioTimeoutSeconds !== undefined) {
		await detectTimeoutTool();
	}

	// @spec FR-096: Short-schedule warning — .specs/features/015-wrapper-protections/spec.md#fr-096
	if (!values.timeout && !(await hasDefaultTimeoutRatio())) {
		const intervalSeconds = scheduleToIntervalSeconds(schedule);
		if (intervalSeconds !== null && intervalSeconds <= 60) {
			console.error(formatWarning("Schedule runs every minute. Consider adding --timeout to prevent overlap."));
		}
	}

	// @spec FR-051: Pass notify flag to task creation — .specs/features/008-failure-notifications/spec.md#fr-051
	const task = await service.add({
		name,
		schedule,
		command: resolution.resolved,
		notify: values.notify ?? false,
		tags: values.tag,
		allowParallel: values["allow-parallel"] ?? false,
		timeout: values.timeout,
	});

	// @spec FR-042: Generate wrapper on add — .specs/features/005-wrapper-script-generation/spec.md#fr-042
	// @spec FR-086: Pass protection fields to wrapper gen — .specs/features/015-wrapper-protections/spec.md#fr-086
	const wrapperService = new WrapperService(getDataDir());
	await wrapperService.generate({
		...task,
		configPath: getTasksPath(),
	});

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
// @spec FR-088: Parse --allow-parallel and --timeout on update — .specs/features/015-wrapper-protections/spec.md#fr-088
export async function handleUpdate(args: string[], service: TaskService, repo: TaskRepository): Promise<void> {
	const name = args[0];
	if (!name) {
		console.error(
			formatError("Missing task name", "Usage: cronshed update <name> --schedule '<cron>' --command '<cmd>'"),
		);
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
			"allow-parallel": { type: "boolean" },
			"no-allow-parallel": { type: "boolean" },
			timeout: { type: "string" },
			"no-timeout": { type: "boolean" },
		},
		allowPositionals: false,
	});

	// Validate timeout format if provided
	if (values.timeout) {
		parseDuration(values.timeout); // throws on invalid format
	}

	// @spec FR-017: Path resolution on update — .specs/features/002-command-path-resolution/spec.md#fr-017
	let resolvedCommand = values.command;
	if (values.command) {
		const resolution = await resolveCommand(values.command);
		resolvedCommand = resolution.resolved;
	}

	// Resolve notify: --notify wins over --no-notify, undefined if neither
	const notifyValue = values.notify === true ? true : values["no-notify"] === true ? false : undefined;

	// Resolve allowParallel: --allow-parallel wins over --no-allow-parallel
	const allowParallelValue =
		values["allow-parallel"] === true ? true : values["no-allow-parallel"] === true ? false : undefined;

	// Resolve timeout: --timeout <value> sets explicit timeout; --no-timeout clears it.
	let timeoutValue: string | null | undefined;
	if (values.timeout) {
		timeoutValue = values.timeout;
	} else if (values["no-timeout"] === true) {
		timeoutValue = null;
	} else {
		timeoutValue = undefined;
	}

	let requiresTimeoutTool = values.timeout !== undefined;
	if (!requiresTimeoutTool && (values.schedule || values["no-timeout"] === true)) {
		const existingTask = await service.get(name);
		if (values["no-timeout"] !== true && existingTask.timeout) {
			requiresTimeoutTool = true;
		} else {
			const effectiveSchedule = values.schedule ?? existingTask.schedule;
			requiresTimeoutTool = (await computeConfiguredRatioTimeout(effectiveSchedule)) !== undefined;
		}
	}
	if (requiresTimeoutTool) {
		await detectTimeoutTool();
	}

	const task = await service.update(name, {
		schedule: values.schedule,
		command: resolvedCommand,
		notify: notifyValue,
		tags: values.tag,
		untags: values.untag,
		allowParallel: allowParallelValue,
		timeout: timeoutValue,
	});

	// @spec FR-042: Regenerate wrapper on command, notify, or protection change — .specs/features/005-wrapper-script-generation/spec.md#fr-042
	const shouldRegenerate =
		values.schedule ||
		values.command ||
		notifyValue !== undefined ||
		allowParallelValue !== undefined ||
		timeoutValue !== undefined;
	if (shouldRegenerate) {
		const wrapperService = new WrapperService(getDataDir());
		await wrapperService.generate({
			...task,
			schedule: task.schedule,
			configPath: getTasksPath(),
		});
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

	// Kill any running process for this task before removing the wrapper
	const wrapperService = new WrapperService(getDataDir());
	const killed = await wrapperService.killRunningProcess(name);
	if (killed) {
		console.log(formatWarning(`Killed running process for task ${name}`));
	}

	// @spec FR-043: Delete wrapper on remove — .specs/features/005-wrapper-script-generation/spec.md#fr-043
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
