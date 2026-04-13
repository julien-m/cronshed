import { test, expect, describe } from "bun:test";
import { parseDuration, formatDurationForDisplay } from "./duration";

describe("parseDuration", () => {
	test("parses seconds", () => {
		expect(parseDuration("50s")).toBe(50);
	});

	test("parses minutes", () => {
		expect(parseDuration("5m")).toBe(300);
	});

	test("parses hours", () => {
		expect(parseDuration("2h")).toBe(7200);
	});

	test("rejects zero duration", () => {
		expect(() => parseDuration("0s")).toThrow("Invalid timeout duration");
	});

	test("rejects invalid format", () => {
		expect(() => parseDuration("abc")).toThrow("Invalid timeout duration");
	});

	test("rejects negative-looking input", () => {
		expect(() => parseDuration("-5m")).toThrow("Invalid timeout duration");
	});

	test("rejects missing unit", () => {
		expect(() => parseDuration("300")).toThrow("Invalid timeout duration");
	});

	test("rejects unsupported unit", () => {
		expect(() => parseDuration("5d")).toThrow("Invalid timeout duration");
	});
});

describe("formatDurationForDisplay", () => {
	test("formats exact hours", () => {
		expect(formatDurationForDisplay(3600)).toBe("1h");
	});

	test("formats exact minutes", () => {
		expect(formatDurationForDisplay(300)).toBe("5m");
	});

	test("formats seconds", () => {
		expect(formatDurationForDisplay(45)).toBe("45s");
	});

	test("formats non-round minutes as seconds", () => {
		expect(formatDurationForDisplay(90)).toBe("90s");
	});
});
