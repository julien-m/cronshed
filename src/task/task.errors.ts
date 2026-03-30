// @spec FR-008: Domain error classes — .specs/features/001-task-manifest/spec.md#fr-008

export class TaskNotFoundError extends Error {
	constructor(name: string) {
		super(`Task "${name}" not found`);
		this.name = "TaskNotFoundError";
	}
}

export class DuplicateTaskNameError extends Error {
	constructor(name: string) {
		super(`Task "${name}" already exists`);
		this.name = "DuplicateTaskNameError";
	}
}

export class InvalidTaskNameError extends Error {
	constructor(name: string) {
		super(`Invalid task name. Use lowercase letters, numbers, and hyphens only.`);
		this.name = "InvalidTaskNameError";
	}
}

export class EmptyCommandError extends Error {
	constructor() {
		super("Command cannot be empty");
		this.name = "EmptyCommandError";
	}
}

export class ManifestCorruptedError extends Error {
	constructor(path: string) {
		super(`tasks.json is corrupted (invalid JSON)`);
		this.name = "ManifestCorruptedError";
		this.path = path;
	}
	readonly path: string;
}

export class ManifestVersionError extends Error {
	constructor(expected: number, got: unknown) {
		super(`Unsupported manifest version (expected ${expected}, got ${got})`);
		this.name = "ManifestVersionError";
	}
}

export class NoChangesSpecifiedError extends Error {
	constructor() {
		super("No changes specified. Use --schedule or --command");
		this.name = "NoChangesSpecifiedError";
	}
}

// @spec FR-061: TaskAlreadyPausedError — .specs/features/009-task-pause-resume/spec.md#fr-061
export class TaskAlreadyPausedError extends Error {
	constructor(name: string) {
		super(`Task "${name}" is already paused`);
		this.name = "TaskAlreadyPausedError";
	}
}

// @spec FR-061: TaskAlreadyActiveError — .specs/features/009-task-pause-resume/spec.md#fr-061
export class TaskAlreadyActiveError extends Error {
	constructor(name: string) {
		super(`Task "${name}" is already active`);
		this.name = "TaskAlreadyActiveError";
	}
}

export class ManifestAccessError extends Error {
	constructor(path: string, cause?: Error) {
		super(`Cannot access ${path}`);
		this.name = "ManifestAccessError";
		this.path = path;
		if (cause) this.cause = cause;
	}
	readonly path: string;
}
