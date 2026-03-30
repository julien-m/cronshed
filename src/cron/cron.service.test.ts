import { test, expect, describe } from "bun:test";
import { validateCronExpression, getNextExecution } from "./cron.service";
import { InvalidCronExpressionError } from "./cron.errors";

describe("validateCronExpression", () => {
	test("AC-002: accepts valid 5-field cron expressions", () => {
		expect(() => validateCronExpression("*/5 * * * *")).not.toThrow();
		expect(() => validateCronExpression("0 2 * * *")).not.toThrow();
		expect(() => validateCronExpression("0 0 1 1 *")).not.toThrow();
		expect(() => validateCronExpression("0 9 * * 1-5")).not.toThrow();
	});

	test("AC-002: rejects invalid cron expressions", () => {
		expect(() => validateCronExpression("bad")).toThrow(InvalidCronExpressionError);
		expect(() => validateCronExpression("not-a-cron")).toThrow(InvalidCronExpressionError);
		expect(() => validateCronExpression("")).toThrow(InvalidCronExpressionError);
	});

	test("AC-002: error message includes the invalid expression", () => {
		try {
			validateCronExpression("bad-expr");
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(InvalidCronExpressionError);
			expect((err as InvalidCronExpressionError).message).toContain("bad-expr");
		}
	});
});

describe("getNextExecution", () => {
	// @spec AC-008: getNextExecution returns correct next Date

	test("AC-008: returns a future date for a valid cron expression", () => {
		const next = getNextExecution("*/5 * * * *");
		expect(next).toBeInstanceOf(Date);
		expect(next.getTime()).toBeGreaterThan(Date.now());
	});

	test("AC-008: daily at midnight returns next midnight", () => {
		const next = getNextExecution("0 0 * * *");
		expect(next).toBeInstanceOf(Date);
		expect(next.getMinutes()).toBe(0);
		expect(next.getHours()).toBe(0);
	});

	test("AC-008: every 30 minutes returns within 30 minutes", () => {
		const next = getNextExecution("*/30 * * * *");
		const now = new Date();
		const diffMs = next.getTime() - now.getTime();
		// Should be within 30 minutes (1800000ms)
		expect(diffMs).toBeGreaterThan(0);
		expect(diffMs).toBeLessThanOrEqual(30 * 60 * 1000);
	});

	test("AC-008: throws InvalidCronExpressionError for invalid expression", () => {
		expect(() => getNextExecution("bad")).toThrow(InvalidCronExpressionError);
	});
});
