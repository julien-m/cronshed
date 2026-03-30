import { test, expect, describe, afterEach } from "bun:test";
import { getDataDir, getTasksPath, getWrappersDir, getLogsDir, getWrapperPath, getLogPath } from "./config";
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

	test("getWrappersDir returns wrappers/ in data dir", () => {
		process.env["CRONSHED_HOME"] = "/tmp/test-dir";
		expect(getWrappersDir()).toBe("/tmp/test-dir/wrappers");
	});

	test("getLogsDir returns logs/ in data dir", () => {
		process.env["CRONSHED_HOME"] = "/tmp/test-dir";
		expect(getLogsDir()).toBe("/tmp/test-dir/logs");
	});

	test("getWrapperPath returns correct wrapper script path", () => {
		process.env["CRONSHED_HOME"] = "/tmp/test-dir";
		expect(getWrapperPath("backup-db")).toBe("/tmp/test-dir/wrappers/backup-db.sh");
	});

	test("getLogPath returns correct JSONL log path", () => {
		process.env["CRONSHED_HOME"] = "/tmp/test-dir";
		expect(getLogPath("backup-db")).toBe("/tmp/test-dir/logs/backup-db.jsonl");
	});
});
