// @spec FR-090: Duration parsing for timeout — .specs/features/015-wrapper-protections/spec.md#fr-090

const DURATION_REGEX = /^(\d+)(s|m|h)$/;

const UNIT_MULTIPLIERS: Record<string, number> = {
	s: 1,
	m: 60,
	h: 3600,
};

/**
 * Parse a duration string (e.g., "50s", "5m", "2h") to seconds.
 * Rejects zero, negative, and invalid formats.
 * @param input Duration string
 * @returns Duration in seconds
 * @throws Error if format is invalid or value is zero
 */
export function parseDuration(input: string): number {
	const match = DURATION_REGEX.exec(input);
	if (!match) {
		throw new Error(`Invalid timeout duration "${input}". Use format: <N>s, <N>m, or <N>h (e.g., "30s", "5m", "2h")`);
	}

	const valueText = match[1] ?? "";
	const unit = match[2] ?? "";
	const value = parseInt(valueText, 10);

	if (value === 0) {
		throw new Error(`Invalid timeout duration "${input}". Use format: <N>s, <N>m, or <N>h (e.g., "30s", "5m", "2h")`);
	}

	return value * (UNIT_MULTIPLIERS[unit] ?? 0);
}

/**
 * Format seconds as a human-readable duration string.
 * @param seconds Duration in seconds
 * @returns Human-readable string (e.g., "5m", "2h", "90s")
 */
export function formatDurationForDisplay(seconds: number): string {
	if (seconds >= 3600 && seconds % 3600 === 0) {
		return `${seconds / 3600}h`;
	}
	if (seconds >= 60 && seconds % 60 === 0) {
		return `${seconds / 60}m`;
	}
	return `${seconds}s`;
}
