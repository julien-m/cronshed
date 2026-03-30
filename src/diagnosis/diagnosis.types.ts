// @spec FR-068: Diagnosis result types — .specs/features/010-task-diagnosis/spec.md#fr-068

/** Severity of a diagnosis issue. */
export type IssueSeverity = "error" | "warning";

/** A single issue found during task diagnosis. */
export interface DiagnosisIssue {
	check: string;
	severity: IssueSeverity;
	message: string;
	hint?: string;
}

/** Diagnosis result for a single task. */
export interface DiagnosisResult {
	taskName: string;
	status: "ok" | "issues";
	issues: DiagnosisIssue[];
}

/** Check name constants for consistent identification. */
export const DIAGNOSIS_CHECKS = {
	CRON_EXPRESSION: "cron-expression",
	COMMAND_FILE_NOT_FOUND: "command-file-not-found",
	COMMAND_FILE_NOT_EXECUTABLE: "command-file-not-executable",
	COMMAND_FILE_IS_DIRECTORY: "command-file-is-directory",
	WRAPPER_MISSING: "wrapper-missing",
	WRAPPER_STALE: "wrapper-stale",
	CRONTAB_ENTRY_MISSING: "crontab-entry-missing",
} as const;
