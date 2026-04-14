// Barrel re-export — all public formatter functions in one place for backwards compatibility.
// Implementation is split across three focused modules:
//   - formatters/base.formatter.ts   — ANSI colors, success/error/warning, shared utilities
//   - formatters/task.formatter.ts   — task table, task details, execution history
//   - formatters/ops.formatter.ts    — sync, diagnosis, import, rotation, run, tags

export {
	formatDuration,
	formatError,
	formatSuccess,
	formatSyncConfirmation,
	formatWarning,
} from "./formatters/base.formatter";
export {
	formatDiagnosisReport,
	formatDiagnosisSummary,
	formatImportPreview,
	formatImportSummary,
	formatRotationSummary,
	formatRunSummary,
	formatSkippedWarning,
	formatSyncDiff,
	formatSyncResult,
	formatTagsTable,
} from "./formatters/ops.formatter";
export {
	formatHistoryTable,
	formatTaskDetails,
	formatTaskTable,
} from "./formatters/task.formatter";
