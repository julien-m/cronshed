// @spec FR-003: Cron expression validation — .specs/features/001-task-manifest/spec.md#fr-003

import { parseExpression } from "cron-parser";
import { InvalidCronExpressionError } from "./cron.errors";

/**
 * Validate a cron expression string.
 * Rejects empty strings and syntactically invalid expressions.
 * @param expression The cron expression to validate
 * @throws InvalidCronExpressionError if expression is empty or invalid
 */
export function validateCronExpression(expression: string): void {
	if (!expression.trim()) {
		throw new InvalidCronExpressionError(expression);
	}
	try {
		parseExpression(expression);
	} catch {
		throw new InvalidCronExpressionError(expression);
	}
}
