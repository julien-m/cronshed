import { test, expect, describe } from "bun:test";
import { scheduleToIntervalSeconds } from "./schedule-interval";

describe("scheduleToIntervalSeconds", () => {
	test("every minute returns 60", () => {
		expect(scheduleToIntervalSeconds("* * * * *")).toBe(60);
	});

	test("every 5 minutes returns 300", () => {
		expect(scheduleToIntervalSeconds("*/5 * * * *")).toBe(300);
	});

	test("every 2 hours returns 7200", () => {
		expect(scheduleToIntervalSeconds("0 */2 * * *")).toBe(7200);
	});

	test("daily returns 86400", () => {
		expect(scheduleToIntervalSeconds("0 0 * * *")).toBe(86400);
	});

	test("9am and 5pm returns minimum gap", () => {
		const result = scheduleToIntervalSeconds("0 9,17 * * *");
		// Gap between 9 and 17 = 8h = 28800s, gap between 17 and next 9 = 16h = 57600s
		// Minimum is 28800
		expect(result).toBe(28800);
	});

	test("every minute shorthand returns 60", () => {
		expect(scheduleToIntervalSeconds("*/1 * * * *")).toBe(60);
	});

	test("invalid expression returns null", () => {
		expect(scheduleToIntervalSeconds("not a cron")).toBeNull();
	});
});
