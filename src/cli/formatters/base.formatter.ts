// Shared ANSI helpers, utility formatters, and feedback primitives.

// ANSI color codes for terminal output (convention: signal/noise maximal, colors for semantic meaning)
// Respects NO_COLOR environment variable per spec: colors disabled only when NO_COLOR is set AND non-empty
// @see https://no-color.org/
export const SUPPORTS_COLOR = process.env.NO_COLOR === undefined || process.env.NO_COLOR === "";
export const ANSI_GREEN = SUPPORTS_COLOR ? "\x1b[32m" : "";
export const ANSI_RED = SUPPORTS_COLOR ? "\x1b[31m" : "";
export const ANSI_YELLOW = SUPPORTS_COLOR ? "\x1b[33m" : "";
export const ANSI_RESET = SUPPORTS_COLOR ? "\x1b[0m" : "";

/**
 * Format a success message prefixed with ✓ in green.
 * @param message The success message to display
 * @returns Formatted success string with green checkmark prefix
 */
export function formatSuccess(message: string): string {
	return `${ANSI_GREEN}\u2713${ANSI_RESET} ${message}`;
}

/**
 * Format an error message prefixed with ✗ in red, with optional actionable hint.
 * @param message The error message
 * @param hint Optional suggestion line prefixed with →
 */
export function formatError(message: string, hint?: string): string {
	let output = `${ANSI_RED}\u2717${ANSI_RESET} Error: ${message}`;
	if (hint) {
		output += `\n${ANSI_RED}\u2192${ANSI_RESET} ${hint}`;
	}
	return output;
}

/**
 * Format a warning message prefixed with ⚠ in yellow, with optional actionable hint.
 * @param message The warning message
 * @param hint Optional suggestion line prefixed with →
 */
// @spec FR-032: Non-fatal auto-sync warning — .specs/features/004-auto-sync/spec.md#fr-032
export function formatWarning(message: string, hint?: string): string {
	let output = `${ANSI_YELLOW}\u26A0${ANSI_RESET} Warning: ${message}`;
	if (hint) {
		output += `\n${ANSI_YELLOW}\u2192${ANSI_RESET} ${hint}`;
	}
	return output;
}

/**
 * Format the auto-sync confirmation message.
 * @returns Formatted sync confirmation string with checkmark prefix
 */
// @spec FR-033: Sync confirmation message — .specs/features/004-auto-sync/spec.md#fr-033
export function formatSyncConfirmation(): string {
	return formatSuccess("Synced to crontab");
}

/**
 * Format an ISO timestamp to a compact local display format (YYYY-MM-DD HH:MM).
 * @param iso ISO 8601 timestamp string
 * @returns Formatted local time string
 */
export function formatTimestamp(iso: string): string {
	const date = new Date(iso);
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, "0");
	const d = String(date.getDate()).padStart(2, "0");
	const h = String(date.getHours()).padStart(2, "0");
	const min = String(date.getMinutes()).padStart(2, "0");
	return `${y}-${m}-${d} ${h}:${min}`;
}

/**
 * Format an ISO timestamp to a compact display format with seconds (YYYY-MM-DD HH:MM:SS).
 * @param iso ISO 8601 timestamp string
 * @returns Formatted local time string
 */
export function formatTimestampWithSeconds(iso: string): string {
	const date = new Date(iso);
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, "0");
	const d = String(date.getDate()).padStart(2, "0");
	const h = String(date.getHours()).padStart(2, "0");
	const min = String(date.getMinutes()).padStart(2, "0");
	const sec = String(date.getSeconds()).padStart(2, "0");
	return `${y}-${m}-${d} ${h}:${min}:${sec}`;
}

/**
 * Truncate a string to maxLen characters, appending "..." if truncated.
 * Replaces newlines with spaces for single-line display.
 * @param str The string to truncate
 * @param maxLen Maximum characters
 * @returns Truncated string
 */
export function truncateOutput(str: string, maxLen: number): string {
	const cleaned = str.replace(/[\n\r]/g, " ");
	if (cleaned.length <= maxLen) {
		return cleaned;
	}
	return cleaned.slice(0, maxLen) + "...";
}

/**
 * Format an exit code with color (green for 0, red for non-zero).
 * @param exitCode The process exit code
 * @returns Colored exit code string
 */
export function formatExitCode(exitCode: number): string {
	if (exitCode === 0) {
		return `${ANSI_GREEN}${exitCode}${ANSI_RESET}`;
	}
	return `${ANSI_RED}${exitCode}${ANSI_RESET}`;
}

/**
 * Format a duration in milliseconds to a human-readable string.
 * @param ms Duration in milliseconds
 * @returns Formatted string (e.g., "1.5s", "2m 30s", "0ms")
 */
export function formatDuration(ms: number): string {
	if (ms < 1000) {
		return `${ms}ms`;
	}
	const totalSeconds = Math.floor(ms / 1000);
	if (totalSeconds < 60) {
		const decimal = ms % 1000;
		if (decimal > 0) {
			return `${(ms / 1000).toFixed(1)}s`;
		}
		return `${totalSeconds}s`;
	}
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (seconds === 0) {
		return `${minutes}m`;
	}
	return `${minutes}m ${seconds}s`;
}
