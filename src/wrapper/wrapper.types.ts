// @spec FR-038: Output truncation limit — .specs/features/005-wrapper-script-generation/spec.md#fr-038

export interface WrapperTimeoutConfig {
	seconds: number;
	tool: string;
}

export interface WrapperConfig {
	taskName: string;
	command: string;
	logPath: string;
	maxOutputBytes: number;
	notify: boolean;
	allowParallel: boolean;
	timeout?: WrapperTimeoutConfig;
	lockFilePath?: string;
	locksDir?: string;
	flockPath?: string;
}

/** Maximum stderr characters included in notification message. */
export const NOTIFY_STDERR_MAX_CHARS = 500;

/** Maximum output bytes per field (stdout/stderr) before truncation. */
export const MAX_OUTPUT_BYTES = 10240;
