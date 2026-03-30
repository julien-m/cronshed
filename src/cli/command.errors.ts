// @spec FR-013: File existence validation, FR-014: Executable permission check — .specs/features/002-command-path-resolution/spec.md#fr-013

/** Thrown when a command file path does not exist on disk. */
export class CommandFileNotFoundError extends Error {
	readonly original: string;
	readonly resolved: string;

	constructor(original: string, resolved: string) {
		super(`File not found: ${original}`);
		this.name = "CommandFileNotFoundError";
		this.original = original;
		this.resolved = resolved;
	}
}

/** Thrown when a command file exists but lacks executable permissions. */
export class CommandFileNotExecutableError extends Error {
	readonly original: string;
	readonly resolved: string;

	constructor(original: string, resolved: string) {
		super(`File is not executable: ${original}`);
		this.name = "CommandFileNotExecutableError";
		this.original = original;
		this.resolved = resolved;
	}
}

/** Thrown when a command path resolves to a directory instead of a file. */
export class CommandPathIsDirectoryError extends Error {
	readonly original: string;
	readonly resolved: string;

	constructor(original: string, resolved: string) {
		super(`Path is a directory, not a file: ${original}`);
		this.name = "CommandPathIsDirectoryError";
		this.original = original;
		this.resolved = resolved;
	}
}
