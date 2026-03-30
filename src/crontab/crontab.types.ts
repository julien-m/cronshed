// @spec FR-021: Crontab entry structure — .specs/features/003-crontab-sync/spec.md#fr-021

export interface CrontabEntry {
	taskName: string;
	schedule: string;
	command: string;
}

export interface ParsedCrontab {
	userLines: string[];
	entries: CrontabEntry[];
}

export const CRONSHED_MARKER_PREFIX = "# cronshed:";
