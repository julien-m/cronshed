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
