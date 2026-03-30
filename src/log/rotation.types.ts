// @spec FR-002: RotationOptions type — .specs/features/012-log-rotation/spec.md#fr-002
// @spec FR-003: RotationResult type — .specs/features/012-log-rotation/spec.md#fr-003

/**
 * Options for log rotation.
 * Controls which entries are pruned and whether files are actually modified.
 */
export interface RotationOptions {
	/** Maximum age in days. Entries older than this are removed. Default: 30 */
	maxAgeDays: number;
	/** Maximum number of entries to keep per task. Default: 1000 */
	maxEntries: number;
	/** If true, calculate but do not modify files. Default: false */
	dryRun: boolean;
	/** Injectable current time for testing. Default: new Date() */
	now?: Date;
}

/**
 * Result of rotating a single task's log file.
 */
export interface RotationResult {
	taskName: string;
	entriesBefore: number;
	entriesAfter: number;
	entriesRemoved: number;
}
