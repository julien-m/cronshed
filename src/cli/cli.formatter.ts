// Barrel re-export — all public formatter functions in one place for backwards compatibility.
// Implementation is split across three focused modules:
//   - formatters/base.formatter.ts   — ANSI colors, success/error/warning, shared utilities
//   - formatters/task.formatter.ts   — task table, task details, execution history
//   - formatters/ops.formatter.ts    — sync, diagnosis, import, rotation, run, tags

export {
	formatSuccess,
	formatError,
	formatWarning,
	formatSyncConfirmation,
	formatDuration,
} from "./formatters/base.formatter";

export {
	formatTaskTable,
	formatTaskDetails,
	formatHistoryTable,
} from "./formatters/task.formatter";

export {
	formatSyncResult,
	formatSyncDiff,
	formatDiagnosisReport,
	formatDiagnosisSummary,
	formatImportPreview,
	formatImportSummary,
	formatSkippedWarning,
	formatRotationSummary,
	formatRunSummary,
	formatTagsTable,
} from "./formatters/ops.formatter";
