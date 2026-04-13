// @spec FR-003: LastExecution type — .specs/features/006-task-listing-status/spec.md#fr-003

/**
 * Data from the most recent JSONL log entry for a task.
 */
export interface LastExecution {
	timestamp: string;
	exitCode: number;
	durationMs: number;
}

// @spec FR-002: ExecutionLogEntry type — .specs/features/007-execution-history/spec.md#fr-002

/**
 * A single parsed entry from the JSONL execution log file.
 * Contains all fields written by wrapper scripts.
 */
// @spec FR-087: Extended log entry with skip/timeout fields — .specs/features/015-wrapper-protections/spec.md#fr-087
export interface ExecutionLogEntry {
	timestamp: string;
	exitCode: number;
	durationMs: number;
	stdout: string;
	stderr: string;
	skipped?: boolean;
	skippedAt?: string;
	reason?: string;
	pidHolder?: number;
	timedOut?: boolean;
}
