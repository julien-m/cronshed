// @spec FR-020: Crontab read/write, FR-021: Marker format, FR-023: Output ordering, FR-026: Empty crontab, FR-028: Orphaned markers — .specs/features/003-crontab-sync/spec.md#fr-020

import type { CrontabEntry, ParsedCrontab } from "./crontab.types";
import { CRONSHED_MARKER_PREFIX } from "./crontab.types";
import { CrontabReadError, CrontabWriteError } from "./crontab.errors";

/** Shell executor interface for testability. */
export interface ShellExecutor {
	exec(cmd: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

/** Default executor using Bun.$ */
export const DEFAULT_EXECUTOR: ShellExecutor = {
	async exec(cmd: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
		const proc = Bun.spawn(cmd, {
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		]);
		const exitCode = await proc.exited;
		return { stdout, stderr, exitCode };
	},
};

/**
 * Parse a task name from a cronshed marker comment.
 * @param line A crontab line
 * @returns The task name if the line is a cronshed marker, undefined otherwise
 */
function parseMarker(line: string): string | undefined {
	if (line.startsWith(CRONSHED_MARKER_PREFIX)) {
		return line.slice(CRONSHED_MARKER_PREFIX.length).trim();
	}
	return undefined;
}

/**
 * Parse a cron line into schedule and command parts.
 * A cron line has 5 schedule fields followed by the command.
 * @param line The cron line to parse
 * @returns { schedule, command } or undefined if not a valid cron line
 */
function parseCronLine(line: string): { schedule: string; command: string } | undefined {
	const trimmed = line.trim();
	if (!trimmed || trimmed.startsWith("#")) return undefined;

	const parts = trimmed.split(/\s+/);
	if (parts.length < 6) return undefined;

	const schedule = parts.slice(0, 5).join(" ");
	const command = parts.slice(5).join(" ");
	return { schedule, command };
}

export class CrontabAdapter {
	private readonly executor: ShellExecutor;

	constructor(executor?: ShellExecutor) {
		this.executor = executor ?? DEFAULT_EXECUTOR;
	}

	/**
	 * Read and parse the current crontab.
	 * Separates cronshed-managed entries from user lines.
	 * Orphaned markers (no following cron line) are silently discarded.
	 * @returns Parsed crontab with user lines and cronshed entries
	 * @throws CrontabReadError if crontab cannot be read
	 */
	async read(): Promise<ParsedCrontab> {
		const { stdout, stderr, exitCode } = await this.executor.exec(["crontab", "-l"]);

		// macOS: exit code 1 with "no crontab for" means empty crontab
		if (exitCode === 1 && stderr.includes("no crontab for")) {
			return { userLines: [], entries: [] };
		}

		if (exitCode !== 0) {
			throw new CrontabReadError(`Cannot read crontab: ${stderr.trim()}`);
		}

		return this.parse(stdout);
	}

	/**
	 * Parse raw crontab content into structured data.
	 * @param content Raw crontab string
	 * @returns Parsed crontab
	 */
	parse(content: string): ParsedCrontab {
		const lines = content.split("\n");
		const userLines: string[] = [];
		const entries: CrontabEntry[] = [];

		let i = 0;
		while (i < lines.length) {
			const line = lines[i]!;
			const taskName = parseMarker(line);

			if (taskName) {
				// Look at the next line for the cron entry
				const nextLine = lines[i + 1];
				if (nextLine !== undefined) {
					const cronParts = parseCronLine(nextLine);
					if (cronParts) {
						entries.push({
							taskName,
							schedule: cronParts.schedule,
							command: cronParts.command,
						});
						i += 2;
						continue;
					}
				}
				// Orphaned marker (no valid cron line follows) — silently discard (FR-028)
				i++;
				continue;
			}

			// Non-cronshed line — preserve it
			// Skip trailing empty lines that may be separators we added
			userLines.push(line);
			i++;
		}

		// Trim trailing empty lines from userLines
		while (userLines.length > 0 && userLines[userLines.length - 1]!.trim() === "") {
			userLines.pop();
		}

		return { userLines, entries };
	}

	/**
	 * Write a new crontab from user lines and cronshed entries.
	 * User lines appear first, then a blank separator, then cronshed entries sorted by name.
	 * No leading blank line when there are no user lines.
	 * @param userLines Non-cronshed lines to preserve
	 * @param entries Cronshed entries to write (will be sorted alphabetically)
	 * @throws CrontabWriteError if crontab cannot be written
	 */
	async write(userLines: string[], entries: CrontabEntry[]): Promise<void> {
		const content = this.build(userLines, entries);

		const proc = Bun.spawn(["crontab", "-"], {
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
		});
		proc.stdin.write(content);
		proc.stdin.end();

		const stderr = await new Response(proc.stderr).text();
		const exitCode = await proc.exited;

		if (exitCode !== 0) {
			throw new CrontabWriteError(`Cannot write to crontab: ${stderr.trim()}`);
		}
	}

	/**
	 * Build the crontab content string from user lines and entries.
	 * @param userLines Non-cronshed lines
	 * @param entries Cronshed entries (will be sorted alphabetically by taskName)
	 * @returns Complete crontab content string
	 */
	build(userLines: string[], entries: CrontabEntry[]): string {
		const sorted = [...entries].sort((a, b) => a.taskName.localeCompare(b.taskName));
		const parts: string[] = [];

		if (userLines.length > 0) {
			parts.push(...userLines);
			if (sorted.length > 0) {
				parts.push("");
			}
		}

		for (const entry of sorted) {
			parts.push(`${CRONSHED_MARKER_PREFIX}${entry.taskName}`);
			parts.push(`${entry.schedule} ${entry.command}`);
		}

		return parts.join("\n") + "\n";
	}
}
