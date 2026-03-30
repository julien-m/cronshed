// @spec FR-003: LastExecution type — .specs/features/006-task-listing-status/spec.md#fr-003

/**
 * Data from the most recent JSONL log entry for a task.
 */
export interface LastExecution {
	timestamp: string;
	exitCode: number;
	durationMs: number;
}
