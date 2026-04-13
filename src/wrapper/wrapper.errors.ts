/**
 * Error thrown when wrapper script generation fails (directory creation, file write, permissions).
 */
export class WrapperGenerationError extends Error {
	override readonly name = "WrapperGenerationError";
	constructor(
		public readonly taskName: string,
		cause?: Error,
	) {
		super(`Failed to generate wrapper for task "${taskName}"`);
		if (cause) this.cause = cause;
	}
}

// @spec FR-089: Timeout tool missing error — .specs/features/015-wrapper-protections/spec.md#fr-089
/**
 * Error thrown when --timeout is specified but neither gtimeout nor timeout is available.
 */
export class TimeoutToolMissingError extends Error {
	override readonly name = "TimeoutToolMissingError";
	constructor() {
		super(
			"--timeout requires 'timeout' command (GNU coreutils)\n" +
			"  \u2192 macOS: brew install coreutils (provides gtimeout)\n" +
			"  \u2192 Linux: sudo apt-get install coreutils",
		);
	}
}
