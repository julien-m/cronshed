// @spec FR-003: Cron expression validation — .specs/features/001-task-manifest/spec.md#fr-003

import { CronExpressionParser } from "cron-parser";
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
		CronExpressionParser.parse(expression);
	} catch {
		throw new InvalidCronExpressionError(expression);
	}
}

/**
 * Calculate the next execution time for a cron expression.
 * @spec FR-001: Next execution calculation — .specs/features/006-task-listing-status/spec.md#fr-001
 * @param expression Valid cron expression string
 * @returns Date of the next execution after now
 * @throws InvalidCronExpressionError if expression is invalid
 */
export function getNextExecution(expression: string): Date {
	try {
		const interval = CronExpressionParser.parse(expression);
		return interval.next().toDate();
	} catch {
		throw new InvalidCronExpressionError(expression);
	}
}
