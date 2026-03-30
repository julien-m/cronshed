// @spec FR-075: Import types definition — .specs/features/011-import-existing-crontab/spec.md#fr-075

export interface ImportOptions {
	dryRun: boolean;
	prefix?: string;
}

export interface ImportedEntry {
	name: string;
	schedule: string;
	command: string;
	originalLine: string;
}

export interface SkippedEntry {
	line: string;
	reason: string;
}

export interface ImportResult {
	imported: ImportedEntry[];
	skipped: SkippedEntry[];
	dryRun: boolean;
}
