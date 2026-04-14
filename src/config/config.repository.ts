// @spec FR-092: Config persistence — .specs/features/015-wrapper-protections/spec.md#fr-092

import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getDataDir } from "../app/config";
import type { CronshedConfig } from "./config.types";

export class ConfigRepository {
	private readonly configPath: string;

	constructor(configPath?: string) {
		this.configPath = configPath ?? join(getDataDir(), "config.json");
	}

	/**
	 * Load config from disk. Returns empty config if file is missing.
	 * @returns The parsed config object
	 */
	async load(): Promise<CronshedConfig> {
		const file = Bun.file(this.configPath);
		const exists = await file.exists();

		if (!exists) {
			return {};
		}

		try {
			const raw = await file.text();
			return JSON.parse(raw) as CronshedConfig;
		} catch {
			return {};
		}
	}

	/**
	 * Save config to disk. Creates parent directory if needed.
	 * @param config The config to persist
	 */
	async save(config: CronshedConfig): Promise<void> {
		const dir = dirname(this.configPath);
		await mkdir(dir, { recursive: true });
		await Bun.write(this.configPath, `${JSON.stringify(config, null, "\t")}\n`);
	}

	/** Get the resolved path to the config file. */
	getPath(): string {
		return this.configPath;
	}
}
