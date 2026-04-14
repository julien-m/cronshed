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
import { detectTimeoutTool, WrapperService } from "../../wrapper/wrapper.service";
import { resolveCommand } from "../command.resolver";
import { formatError, formatSuccess, formatWarning } from "../formatters/base.formatter";
import { autoSync } from "./shared";

// @spec FR-094: Compute timeout from ratio — .specs/features/015-wrapper-protections/spec.md#fr-094
/** Minimum auto-computed timeout in seconds. */
const MIN_AUTO_TIMEOUT_SECONDS = 10;

/**
 * If explicit timeout is not set, compute timeout from default-timeout-ratio config.
 * Returns the timeout seconds or undefined if no ratio is configured.
 */
async function computeTimeoutFromRatio(schedule: string): Promise<number | undefined> {
	const configRepo = new ConfigRepository();
	const configService = new ConfigService(configRepo);
	const ratioStr = await configService.get("default-timeout-ratio");
	if (!ratioStr) return undefined;

	const ratio = parseFloat(ratioStr);
	const intervalSeconds = scheduleToIntervalSeconds(schedule);
	if (intervalSeconds === null) return undefined;

	const computed = Math.floor(intervalSeconds * ratio);
	return Math.max(computed, MIN_AUTO_TIMEOUT_SECONDS);
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

	// Determine effective timeout
	let effectiveTimeout = values.timeout;
	let effectiveTimeoutSeconds: number | undefined;

	if (values.timeout) {
		effectiveTimeoutSeconds = parseDuration(values.timeout);
	} else {
		// @spec FR-094: Auto-compute timeout from ratio — .specs/features/015-wrapper-protections/spec.md#fr-094
		effectiveTimeoutSeconds = await computeTimeoutFromRatio(schedule);
		if (effectiveTimeoutSeconds !== undefined) {
			effectiveTimeout = `${effectiveTimeoutSeconds}s`;
		}
	}

	// @spec FR-089: Check timeout tool availability — .specs/features/015-wrapper-protections/spec.md#fr-089
	if (effectiveTimeout) {
		await detectTimeoutTool(); // throws TimeoutToolMissingError if not found
	}

	// @spec FR-096: Short-schedule warning — .specs/features/015-wrapper-protections/spec.md#fr-096
	if (!effectiveTimeout) {
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
		timeout: effectiveTimeout,
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

	// Resolve timeout: --timeout <value> sets it, --no-timeout clears it, undefined if neither
	const timeoutValue: string | null | undefined = values.timeout
		? values.timeout
		: values["no-timeout"] === true
			? null
			: undefined;

	// @spec FR-089: Check timeout tool availability on update — .specs/features/015-wrapper-protections/spec.md#fr-089
	if (timeoutValue && timeoutValue !== null) {
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
		values.command || notifyValue !== undefined || allowParallelValue !== undefined || timeoutValue !== undefined;
	if (shouldRegenerate) {
		const wrapperService = new WrapperService(getDataDir());
		await wrapperService.generate({
			...task,
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
