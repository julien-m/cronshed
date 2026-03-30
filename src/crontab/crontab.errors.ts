// @spec FR-027: Crontab error handling — .specs/features/003-crontab-sync/spec.md#fr-027

export class CrontabReadError extends Error {
	constructor(message: string, cause?: Error) {
		super(message);
		this.name = "CrontabReadError";
		if (cause) this.cause = cause;
	}
}

export class CrontabWriteError extends Error {
	constructor(message: string, cause?: Error) {
		super(message);
		this.name = "CrontabWriteError";
		if (cause) this.cause = cause;
	}
}
