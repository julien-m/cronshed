// @spec FR-038: Output truncation limit — .specs/features/005-wrapper-script-generation/spec.md#fr-038

export interface WrapperConfig {
	taskName: string;
	command: string;
	logPath: string;
	maxOutputBytes: number;
}

/** Maximum output bytes per field (stdout/stderr) before truncation. */
export const MAX_OUTPUT_BYTES = 10240;
