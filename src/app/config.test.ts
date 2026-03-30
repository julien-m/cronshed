import { test, expect, describe, afterEach } from "bun:test";
import { getDataDir, getTasksPath } from "./config";
import { homedir } from "node:os";
import { join } from "node:path";

describe("config", () => {
	const originalEnv = process.env["CRONSHED_HOME"];

	afterEach(() => {
		if (originalEnv === undefined) {
			delete process.env["CRONSHED_HOME"];
		} else {
			process.env["CRONSHED_HOME"] = originalEnv;
		}
	});

	test("AC-016: getDataDir returns CRONSHED_HOME when set", () => {
		process.env["CRONSHED_HOME"] = "/tmp/custom-cronshed";
		expect(getDataDir()).toBe("/tmp/custom-cronshed");
	});

	test("getDataDir returns ~/.cronshed by default", () => {
		delete process.env["CRONSHED_HOME"];
		expect(getDataDir()).toBe(join(homedir(), ".cronshed"));
	});

	test("getTasksPath returns tasks.json in data dir", () => {
		process.env["CRONSHED_HOME"] = "/tmp/test-dir";
		expect(getTasksPath()).toBe("/tmp/test-dir/tasks.json");
	});
});
