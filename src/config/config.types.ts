// @spec FR-092: CronshedConfig type — .specs/features/015-wrapper-protections/spec.md#fr-092

export interface CronshedConfig {
	defaultTimeoutRatio?: number;
}

/** Valid config keys that can be set/get via the CLI. */
export const VALID_CONFIG_KEYS = ["default-timeout-ratio"] as const;

export type ConfigKey = (typeof VALID_CONFIG_KEYS)[number];

/** Map from CLI key names to CronshedConfig property names. */
export const CONFIG_KEY_MAP: Record<ConfigKey, keyof CronshedConfig> = {
	"default-timeout-ratio": "defaultTimeoutRatio",
};
