// @spec FR-075: ImportService class, FR-076: parseUserLine, FR-077: generateTaskName, FR-078: resolveNameConflict — .specs/features/011-import-existing-crontab/spec.md#fr-075

import { validateCronExpression } from "../cron/cron.service";
import { TASK_NAME_REGEX } from "../task/task.types";
import type { ImportedEntry, ImportOptions, ImportResult, SkippedEntry } from "./import.types";

/** Pattern matching environment variable assignments in crontab. */
// @spec FR-085: Skip env variable lines — .specs/features/011-import-existing-crontab/spec.md#fr-085
const ENV_VAR_PATTERN = /^[A-Z_][A-Z0-9_]*=/;

/**
 * Parse a single userLine from crontab into schedule and command.
 * Returns null for non-cron lines (comments, empty, env vars, invalid).
 * @spec FR-076: Parse user lines — .specs/features/011-import-existing-crontab/spec.md#fr-076
 * @param line A single line from the crontab userLines
 * @returns Parsed schedule and command, or null if not a valid cron entry
 */
export function parseUserLine(line: string): { schedule: string; command: string } | null {
	const trimmed = line.trim();

	// Skip empty lines
	if (!trimmed) return null;

	// Skip comment lines
	if (trimmed.startsWith("#")) return null;

	// Skip environment variable assignments
	if (ENV_VAR_PATTERN.test(trimmed)) return null;

	// A cron line has 5 schedule fields followed by the command
	const parts = trimmed.split(/\s+/);
	if (parts.length < 6) return null;

	const schedule = parts.slice(0, 5).join(" ");
	const command = parts.slice(5).join(" ");

	// Validate cron expression
	// @spec FR-084: Validate cron before import — .specs/features/011-import-existing-crontab/spec.md#fr-084
	try {
		validateCronExpression(schedule);
	} catch {
		return null;
	}

	return { schedule, command };
}

/**
 * Generate a task name from a cron command string.
 * Extracts the first token (before pipes/redirects), takes basename, removes extension,
 * normalizes to kebab-case, and optionally prepends a prefix.
 * @spec FR-077: Auto-generate task names — .specs/features/011-import-existing-crontab/spec.md#fr-077
 * @param command The full command string from the crontab
 * @param prefix Optional prefix to prepend
 * @returns A kebab-case task name
 */
export function generateTaskName(command: string, prefix?: string): string {
	// Extract first token before pipe, redirect, semicolon, or &&
	const firstCmd =
		command
			.split(/[|><;&]/)
			.at(0)
			?.trim() ?? command.trim();

	// Split by whitespace to get the executable (first arg)
	const executable = firstCmd.split(/\s+/).at(0) ?? firstCmd;

	// Extract basename from path
	const basename = executable.split("/").at(-1) ?? executable;

	// Remove common file extensions
	const withoutExt = basename.replace(/\.(sh|py|js|ts|rb|pl|bash|zsh|csh)$/i, "");

	// Normalize: replace underscores, dots, and non-alphanumeric with hyphens
	const normalized = withoutExt
		.toLowerCase()
		.replace(/[_.]/g, "-")
		.replace(/[^a-z0-9-]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");

	// Validate against TASK_NAME_REGEX; fallback if empty or invalid
	const candidate = normalized || "imported-task";
	const name = TASK_NAME_REGEX.test(candidate) ? candidate : "imported-task";

	// Prepend prefix if provided
	if (prefix) {
		return `${prefix}-${name}`;
	}

	return name;
}

/**
 * Resolve a name conflict by appending a numeric suffix.
 * Tries name-2, name-3, ... until a unique name is found.
 * @spec FR-078: Resolve name conflicts — .specs/features/011-import-existing-crontab/spec.md#fr-078
 * @param baseName The desired task name
 * @param existingNames Set of names already in use
 * @returns A unique task name
 */
export function resolveNameConflict(baseName: string, existingNames: Set<string>): string {
	if (!existingNames.has(baseName)) {
		return baseName;
	}

	for (let i = 2; i <= 99; i++) {
		const candidate = `${baseName}-${i}`;
		if (!existingNames.has(candidate)) {
			return candidate;
		}
	}

	// Extremely unlikely: 98 conflicts with the same base name
	return `${baseName}-${Date.now()}`;
}

/**
 * Import crontab user lines into task entries.
 * Parses each line, generates task names, resolves conflicts, and returns the result.
 * @spec FR-075: Import orchestration — .specs/features/011-import-existing-crontab/spec.md#fr-075
 * @param userLines Non-cronshed lines from the crontab
 * @param existingNames Names of tasks already in tasks.json
 * @param options Import options (dryRun, prefix)
 * @returns Import result with imported and skipped entries
 */
export function importCrontabEntries(
	userLines: string[],
	existingNames: Set<string>,
	options: ImportOptions,
): ImportResult {
	const imported: ImportedEntry[] = [];
	const skipped: SkippedEntry[] = [];
	const usedNames = new Set(existingNames);

	for (const line of userLines) {
		const trimmed = line.trim();

		// Skip empty and whitespace-only lines silently
		if (!trimmed) continue;

		const parsed = parseUserLine(line);

		if (!parsed) {
			// Only report meaningful skips (not empty lines)
			if (trimmed.startsWith("#")) {
				// Comments are expected, skip silently
				continue;
			}
			if (ENV_VAR_PATTERN.test(trimmed)) {
				skipped.push({ line: trimmed, reason: "Environment variable" });
				continue;
			}
			skipped.push({ line: trimmed, reason: "Invalid cron format" });
			continue;
		}

		const baseName = generateTaskName(parsed.command, options.prefix);
		const name = resolveNameConflict(baseName, usedNames);
		usedNames.add(name);

		imported.push({
			name,
			schedule: parsed.schedule,
			command: parsed.command,
			originalLine: trimmed,
		});
	}

	return { imported, skipped, dryRun: options.dryRun };
}
