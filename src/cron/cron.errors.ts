// @spec FR-003: Cron validation error — .specs/features/001-task-manifest/spec.md#fr-003

export class InvalidCronExpressionError extends Error {
	constructor(expression: string) {
		super(`Invalid cron expression "${expression}"`);
		this.name = "InvalidCronExpressionError";
		this.expression = expression;
	}
	readonly expression: string;
}
