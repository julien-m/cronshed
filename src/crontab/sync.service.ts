// @spec FR-022: Sync algorithm, FR-024: Dry-run, FR-025: Clear — .specs/features/003-crontab-sync/spec.md#fr-022

import type { Task } from "../task/task.types";
import { TASK_STATUS } from "../task/task.types";
import type { TaskRepository } from "../task/task.repository";
import type { CrontabEntry } from "./crontab.types";
import type { CrontabAdapter } from "./crontab.adapter";
import type { WrapperService } from "../wrapper/wrapper.service";

export interface SyncOptions {
	dryRun?: boolean;
	clear?: boolean;
}

export interface SyncDiffEntry {
	type: "install" | "update" | "remove";
	taskName: string;
	schedule?: string;
	command?: string;
	oldSchedule?: string;
	oldCommand?: string;
}

export interface SyncResult {
	installed: number;
	updated: number;
	removed: number;
	total: number;
	isUpToDate: boolean;
	diff: SyncDiffEntry[];
}

/**
 * Compute the diff between manifest tasks and crontab entries.
 * @param tasks Tasks from manifest
 * @param entries Existing cronshed entries from crontab
 * @returns Array of diff entries describing what changed
 */
function computeDiff(tasks: Task[], entries: CrontabEntry[]): SyncDiffEntry[] {
	const entryMap = new Map(entries.map((e) => [e.taskName, e]));
	const taskMap = new Map(tasks.map((t) => [t.name, t]));
	const diff: SyncDiffEntry[] = [];

	// Install or update
	for (const task of tasks) {
		const existing = entryMap.get(task.name);
		if (!existing) {
			diff.push({
				type: "install",
				taskName: task.name,
				schedule: task.schedule,
				command: task.command,
			});
		} else if (existing.schedule !== task.schedule || existing.command !== task.command) {
			diff.push({
				type: "update",
				taskName: task.name,
				schedule: task.schedule,
				command: task.command,
				oldSchedule: existing.schedule,
				oldCommand: existing.command,
			});
		}
	}

	// Remove orphaned entries
	for (const entry of entries) {
		if (!taskMap.has(entry.taskName)) {
			diff.push({
				type: "remove",
				taskName: entry.taskName,
				schedule: entry.schedule,
				command: entry.command,
			});
		}
	}

	return diff;
}

export class SyncService {
	// @spec FR-044: SyncService accepts optional WrapperService — .specs/features/005-wrapper-script-generation/spec.md#fr-044
	constructor(
		private readonly repo: TaskRepository,
		private readonly adapter: CrontabAdapter,
		private readonly wrapperService?: WrapperService,
	) {}

	/**
	 * Sync the task manifest with the system crontab.
	 * @param options Sync options (dryRun, clear)
	 * @returns Sync result with counts and diff
	 */
	async sync(options: SyncOptions = {}): Promise<SyncResult> {
		if (options.clear) {
			return this.handleClear(options.dryRun ?? false);
		}

		const manifest = await this.repo.load();
		// @spec FR-059: Filter paused tasks before sync — .specs/features/009-task-pause-resume/spec.md#fr-059
		const tasks = manifest.tasks.filter((t) => t.status === TASK_STATUS.ACTIVE);

		// @spec FR-044: Regenerate wrappers before sync (skip on dry-run) — .specs/features/005-wrapper-script-generation/spec.md#fr-044
		if (this.wrapperService && !options.dryRun) {
			await this.wrapperService.syncWrappers(tasks);
		}

		// Build entries with wrapper paths when wrapperService is available
		const crontabTasks = tasks.map((t) => ({
			...t,
			command: this.wrapperService
				? this.wrapperService.getWrapperPath(t.name)
				: t.command,
		}));

		const crontab = await this.adapter.read();

		const diff = computeDiff(crontabTasks, crontab.entries);

		const result: SyncResult = {
			installed: diff.filter((d) => d.type === "install").length,
			updated: diff.filter((d) => d.type === "update").length,
			removed: diff.filter((d) => d.type === "remove").length,
			total: tasks.length,
			isUpToDate: diff.length === 0,
			diff,
		};

		if (result.isUpToDate || options.dryRun) {
			return result;
		}

		// Build new entries from manifest tasks (with wrapper paths if available)
		const newEntries: CrontabEntry[] = crontabTasks.map((t) => ({
			taskName: t.name,
			schedule: t.schedule,
			command: t.command,
		}));

		await this.adapter.write(crontab.userLines, newEntries);
		return result;
	}

	/**
	 * Remove all cronshed entries from the crontab.
	 * @param dryRun If true, compute but do not write
	 * @returns Sync result with removed count
	 */
	private async handleClear(dryRun: boolean): Promise<SyncResult> {
		const crontab = await this.adapter.read();
		const removeDiff: SyncDiffEntry[] = crontab.entries.map((e) => ({
			type: "remove" as const,
			taskName: e.taskName,
			schedule: e.schedule,
			command: e.command,
		}));

		const result: SyncResult = {
			installed: 0,
			updated: 0,
			removed: crontab.entries.length,
			total: 0,
			isUpToDate: crontab.entries.length === 0,
			diff: removeDiff,
		};

		if (result.isUpToDate || dryRun) {
			return result;
		}

		await this.adapter.write(crontab.userLines, []);
		return result;
	}
}
