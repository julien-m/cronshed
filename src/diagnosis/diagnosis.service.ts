// @spec FR-063: DiagnosisService — .specs/features/010-task-diagnosis/spec.md#fr-063

import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseExpression } from "cron-parser";
import { isFilePath } from "../cli/command.resolver";
import type { CrontabAdapter } from "../crontab/crontab.adapter";
import type { CrontabEntry } from "../crontab/crontab.types";
import type { TaskRepository } from "../task/task.repository";
import type { Task } from "../task/task.types";
import { TASK_STATUS } from "../task/task.types";
import { parseDuration } from "../wrapper/duration";
import type { WrapperService } from "../wrapper/wrapper.service";
import { computeLockHash } from "../wrapper/wrapper.service";
import type { WrapperTimeoutConfig } from "../wrapper/wrapper.types";
import { MAX_OUTPUT_BYTES } from "../wrapper/wrapper.types";
import type { DiagnosisIssue, DiagnosisResult } from "./diagnosis.types";
import { DIAGNOSIS_CHECKS } from "./diagnosis.types";

export class DiagnosisService {
	private readonly logsDir: string;

	constructor(
		private readonly repo: TaskRepository,
		private readonly adapter: CrontabAdapter,
		private readonly wrapperService: WrapperService,
		private readonly dataDir: string,
	) {
		this.logsDir = join(dataDir, "logs");
	}

	/**
	 * Diagnose all tasks in the manifest.
	 * Reads crontab once and passes entries to each task check.
	 * @returns Array of diagnosis results, one per task
	 */
	// @spec FR-063: diagnoseAll method — .specs/features/010-task-diagnosis/spec.md#fr-063
	async diagnoseAll(): Promise<DiagnosisResult[]> {
		const manifest = await this.repo.load();
		if (manifest.tasks.length === 0) {
			return [];
		}

		const crontabEntries = await this.readCrontabSafe();
		const results: DiagnosisResult[] = [];

		for (const task of manifest.tasks) {
			const result = await this.diagnoseTask(task, crontabEntries);
			results.push(result);
		}

		return results;
	}

	/**
	 * Diagnose a single task.
	 * @param task The task to diagnose
	 * @returns Diagnosis result with issues
	 */
	// @spec FR-063: diagnose method — .specs/features/010-task-diagnosis/spec.md#fr-063
	async diagnose(task: Task): Promise<DiagnosisResult> {
		const crontabEntries = await this.readCrontabSafe();
		return this.diagnoseTask(task, crontabEntries);
	}

	/**
	 * Run all checks on a single task with pre-loaded crontab entries.
	 */
	private async diagnoseTask(task: Task, crontabEntries: CrontabEntry[] | null): Promise<DiagnosisResult> {
		const issues: DiagnosisIssue[] = [];

		// @spec FR-064: Cron expression check — .specs/features/010-task-diagnosis/spec.md#fr-064
		this.checkCronExpression(task, issues);

		// @spec FR-065: Command file checks — .specs/features/010-task-diagnosis/spec.md#fr-065
		await this.checkCommandFile(task, issues);

		// @spec FR-066: Wrapper check — .specs/features/010-task-diagnosis/spec.md#fr-066
		await this.checkWrapper(task, issues);

		// @spec FR-067: Crontab entry check — .specs/features/010-task-diagnosis/spec.md#fr-067
		this.checkCrontabEntry(task, crontabEntries, issues);

		return {
			taskName: task.name,
			status: issues.length > 0 ? "issues" : "ok",
			issues,
		};
	}

	/**
	 * Validate cron expression with cron-parser.
	 */
	private checkCronExpression(task: Task, issues: DiagnosisIssue[]): void {
		if (!task.schedule.trim()) {
			issues.push({
				check: DIAGNOSIS_CHECKS.CRON_EXPRESSION,
				severity: "error",
				message: "Invalid cron expression: (empty)",
			});
			return;
		}
		try {
			parseExpression(task.schedule);
		} catch {
			issues.push({
				check: DIAGNOSIS_CHECKS.CRON_EXPRESSION,
				severity: "error",
				message: `Invalid cron expression: ${task.schedule}`,
			});
		}
	}

	/**
	 * Check command file existence, type, and permissions.
	 * Only applies to file-path commands (not inline commands).
	 */
	private async checkCommandFile(task: Task, issues: DiagnosisIssue[]): Promise<void> {
		if (!isFilePath(task.command)) {
			return; // Inline command, skip file checks
		}

		// Extract the file path (first token, before arguments)
		const firstToken = task.command.split(" ")[0] ?? "";
		let filePath: string;
		if (firstToken.startsWith("~/")) {
			filePath = resolve(homedir(), firstToken.slice(2));
		} else {
			filePath = resolve(firstToken);
		}

		try {
			const fileStat = await stat(filePath);

			if (fileStat.isDirectory()) {
				issues.push({
					check: DIAGNOSIS_CHECKS.COMMAND_FILE_IS_DIRECTORY,
					severity: "error",
					message: `Command path is a directory: ${filePath}`,
				});
				return;
			}

			try {
				await access(filePath, constants.X_OK);
			} catch {
				issues.push({
					check: DIAGNOSIS_CHECKS.COMMAND_FILE_NOT_EXECUTABLE,
					severity: "error",
					message: `Command file not executable: ${filePath}`,
					hint: `Run: chmod +x ${filePath}`,
				});
			}
		} catch {
			issues.push({
				check: DIAGNOSIS_CHECKS.COMMAND_FILE_NOT_FOUND,
				severity: "error",
				message: `Command file not found: ${filePath}`,
			});
		}
	}

	/**
	 * Check wrapper script existence and staleness.
	 * Compares on-disk content with expected output, ignoring the Generated timestamp line.
	 */
	private async checkWrapper(task: Task, issues: DiagnosisIssue[]): Promise<void> {
		const wrapperPath = this.wrapperService.getWrapperPath(task.name);

		let onDiskContent: string;
		try {
			const file = Bun.file(wrapperPath);
			const exists = await file.exists();
			if (!exists) {
				issues.push({
					check: DIAGNOSIS_CHECKS.WRAPPER_MISSING,
					severity: "warning",
					message: "Wrapper script missing",
					hint: "Run 'cronshed sync' to regenerate",
				});
				return;
			}
			onDiskContent = await file.text();
		} catch {
			issues.push({
				check: DIAGNOSIS_CHECKS.WRAPPER_MISSING,
				severity: "warning",
				message: "Wrapper script missing",
				hint: "Run 'cronshed sync' to regenerate",
			});
			return;
		}

		// Generate expected content and compare (strip Generated timestamp for comparison)
		const logPath = join(this.logsDir, `${task.name}.jsonl`);
		const isParallel = task.allowParallel ?? false;
		const locksDir = !isParallel ? join(this.dataDir, "locks") : undefined;
		const configPath = this.repo.getPath();
		const lockFilePath = !isParallel ? `$CRONSHED_LOCK_DIR/${computeLockHash(configPath, task.name)}.lock` : undefined;

		// Resolve timeout config for comparison
		let timeoutConfig: WrapperTimeoutConfig | undefined;
		if (task.timeout) {
			try {
				const seconds = parseDuration(task.timeout);
				// We cannot async detect the tool here, so read it from the on-disk wrapper
				const toolMatch = onDiskContent.match(/CRONSHED_TIMEOUT_CMD="([^"]+)"/);
				if (toolMatch) {
					timeoutConfig = { seconds, tool: toolMatch[1] ?? "" };
				}
			} catch {
				// If duration is invalid, skip timeout comparison
			}
		}

		// Resolve flock path from on-disk wrapper for comparison
		let flockPath: string | undefined;
		if (!isParallel) {
			const flockMatch = onDiskContent.match(/^\s+(\S+flock) -n 9/m);
			if (flockMatch) {
				flockPath = flockMatch[1] ?? "";
			}
		}

		const expectedContent = this.wrapperService.buildScript({
			taskName: task.name,
			command: task.command,
			logPath,
			maxOutputBytes: MAX_OUTPUT_BYTES,
			notify: task.notify,
			allowParallel: isParallel,
			lockFilePath,
			locksDir,
			timeout: timeoutConfig,
			flockPath,
		});

		const stripTimestamp = (content: string): string => content.replace(/^# Generated: .*$/m, "");

		if (stripTimestamp(onDiskContent) !== stripTimestamp(expectedContent)) {
			issues.push({
				check: DIAGNOSIS_CHECKS.WRAPPER_STALE,
				severity: "warning",
				message: "Wrapper script is stale",
				hint: "Run 'cronshed sync' to regenerate",
			});
		}
	}

	/**
	 * Check that active tasks have a crontab entry.
	 * Paused tasks are expected to have no entry.
	 */
	private checkCrontabEntry(task: Task, crontabEntries: CrontabEntry[] | null, issues: DiagnosisIssue[]): void {
		// If crontab could not be read, skip this check
		if (crontabEntries === null) {
			return;
		}

		// Paused tasks are expected to have no crontab entry
		if (task.status === TASK_STATUS.PAUSED) {
			return;
		}

		const hasEntry = crontabEntries.some((e) => e.taskName === task.name);
		if (!hasEntry) {
			issues.push({
				check: DIAGNOSIS_CHECKS.CRONTAB_ENTRY_MISSING,
				severity: "warning",
				message: "Crontab entry missing",
				hint: "Run 'cronshed sync' to install",
			});
		}
	}

	/**
	 * Read crontab entries, returning null if the read fails.
	 * This allows other checks to proceed even if crontab is inaccessible.
	 */
	private async readCrontabSafe(): Promise<CrontabEntry[] | null> {
		try {
			const parsed = await this.adapter.read();
			return parsed.entries;
		} catch {
			return null;
		}
	}
}
