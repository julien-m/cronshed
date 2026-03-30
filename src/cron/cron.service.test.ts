import { test, expect, describe } from "bun:test";
import { validateCronExpression } from "./cron.service";
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
