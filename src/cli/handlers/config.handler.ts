// @spec FR-093: Config CLI commands — .specs/features/015-wrapper-protections/spec.md#fr-093

import { ConfigService, InvalidConfigKeyError, InvalidConfigValueError } from "../../config/config.service";
import { ConfigRepository } from "../../config/config.repository";
import { formatSuccess, formatError } from "../formatters/base.formatter";

/**
 * Handle `cronshed config <subcommand>` dispatching.
 * @param args Arguments after "config"
 */
export async function handleConfig(args: string[]): Promise<void> {
	const subcommand = args[0];

	if (subcommand === "set") {
		await handleConfigSet(args.slice(1));
		return;
	}

	if (subcommand === "get") {
		await handleConfigGet(args.slice(1));
		return;
	}

	console.error(formatError(
		"Unknown config subcommand",
		"Usage: cronshed config set <key> <value> | cronshed config get <key>",
	));
	process.exit(2);
}

/**
 * Handle `cronshed config set <key> <value>`.
 */
async function handleConfigSet(args: string[]): Promise<void> {
	const key = args[0];
	const value = args[1];

	if (!key || !value) {
		console.error(formatError(
			"Missing arguments",
			"Usage: cronshed config set <key> <value>",
		));
		process.exit(2);
		return;
	}

	const repo = new ConfigRepository();
	const service = new ConfigService(repo);

	try {
		await service.set(key, value);
		console.log(formatSuccess(`Config ${key} set to ${value}`));
	} catch (err) {
		if (err instanceof InvalidConfigKeyError || err instanceof InvalidConfigValueError) {
			console.error(formatError(err.message));
			process.exit(2);
			return;
		}
		throw err;
	}
}

/**
 * Handle `cronshed config get <key>`.
 */
async function handleConfigGet(args: string[]): Promise<void> {
	const key = args[0];

	if (!key) {
		console.error(formatError(
			"Missing key argument",
			"Usage: cronshed config get <key>",
		));
		process.exit(2);
		return;
	}

	const repo = new ConfigRepository();
	const service = new ConfigService(repo);

	try {
		const value = await service.get(key);
		console.log(value ?? "not set");
	} catch (err) {
		if (err instanceof InvalidConfigKeyError) {
			console.error(formatError(err.message));
			process.exit(2);
			return;
		}
		throw err;
	}
}
