// @spec FR-092: Config get/set with validation — .specs/features/015-wrapper-protections/spec.md#fr-092

import type { ConfigRepository } from "./config.repository";
import type { ConfigKey } from "./config.types";
import { CONFIG_KEY_MAP, VALID_CONFIG_KEYS } from "./config.types";

/** Error thrown when an unknown config key is used. */
export class InvalidConfigKeyError extends Error {
	override readonly name = "InvalidConfigKeyError";
	constructor(key: string) {
		super(`Unknown config key "${key}". Valid keys: ${VALID_CONFIG_KEYS.join(", ")}`);
	}
}

/** Error thrown when a config value fails validation. */
export class InvalidConfigValueError extends Error {
	override readonly name = "InvalidConfigValueError";
}

export class ConfigService {
	constructor(private readonly repo: ConfigRepository) {}

	/**
	 * Get a config value by CLI key name.
	 * @param key The CLI key name (e.g., "default-timeout-ratio")
	 * @returns The value as a string, or undefined if not set
	 */
	async get(key: string): Promise<string | undefined> {
		this.validateKey(key);

		const config = await this.repo.load();
		const propName = CONFIG_KEY_MAP[key as ConfigKey];
		const value = config[propName];

		return value !== undefined ? String(value) : undefined;
	}

	/**
	 * Set a config value by CLI key name.
	 * Validates the value before persisting.
	 * @param key The CLI key name
	 * @param value The value as a string
	 */
	async set(key: string, value: string): Promise<void> {
		this.validateKey(key);

		const config = await this.repo.load();

		if (key === "default-timeout-ratio") {
			const ratio = parseFloat(value);
			if (Number.isNaN(ratio) || ratio <= 0 || ratio > 1) {
				throw new InvalidConfigValueError(
					`default-timeout-ratio must be between 0 and 1 (exclusive 0, inclusive 1). Got: ${value}`,
				);
			}
			config.defaultTimeoutRatio = ratio;
		}

		await this.repo.save(config);
	}

	/** Validate that a key is a known config key. */
	private validateKey(key: string): asserts key is ConfigKey {
		if (!VALID_CONFIG_KEYS.includes(key as ConfigKey)) {
			throw new InvalidConfigKeyError(key);
		}
	}
}
