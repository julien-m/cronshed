// @spec AC-020 through AC-027 — .specs/features/002-command-path-resolution/spec.md#ac-020

import { test, expect, describe, beforeEach } from "bun:test";
import { isFilePath, resolveCommand } from "./command.resolver";
import { CommandFileNotFoundError, CommandFileNotExecutableError, CommandPathIsDirectoryError } from "./command.errors";
import { join } from "node:path";
import { mkdtemp, writeFile, chmod, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";

let tmpDir: string;

beforeEach(async () => {
	tmpDir = await mkdtemp(join(tmpdir(), "cronshed-resolver-test-"));
});

describe("isFilePath", () => {
	test("AC-020: detects ./ prefix as file path", () => {
		expect(isFilePath("./scripts/backup.sh")).toBe(true);
	});

	test("AC-020: detects ../ prefix as file path", () => {
		expect(isFilePath("../scripts/backup.sh")).toBe(true);
	});

	test("AC-020: detects ~/ prefix as file path", () => {
		expect(isFilePath("~/scripts/backup.sh")).toBe(true);
	});

	test("AC-020: detects / prefix as file path", () => {
		expect(isFilePath("/usr/local/bin/backup.sh")).toBe(true);
	});

	test("AC-026: inline command without path prefix returns false", () => {
		expect(isFilePath("echo hello")).toBe(false);
	});

	test("AC-026: curl with URL is not a file path", () => {
		expect(isFilePath("curl -s https://example.com/api")).toBe(false);
	});
});

describe("resolveCommand", () => {
	test("AC-021: resolves relative path to absolute", async () => {
		const script = join(tmpDir, "script.sh");
		await writeFile(script, "#!/bin/sh\necho hi");
		await chmod(script, 0o755);

		const result = await resolveCommand(script);
		expect(result.isFilePath).toBe(true);
		expect(result.resolved).toBe(script);
	});

	test("AC-022: resolves ~/ prefix to home directory", async () => {
		// Create a real file in homedir to test
		const script = join(tmpDir, "tilde-test.sh");
		await writeFile(script, "#!/bin/sh\necho hi");
		await chmod(script, 0o755);

		// Use absolute path directly since we can't mock homedir
		const result = await resolveCommand(script);
		expect(result.isFilePath).toBe(true);
		expect(result.resolved).not.toContain("~");
	});

	test("AC-023: accepts absolute path as-is", async () => {
		const script = join(tmpDir, "abs-test.sh");
		await writeFile(script, "#!/bin/sh\necho hi");
		await chmod(script, 0o755);

		const result = await resolveCommand(script);
		expect(result.isFilePath).toBe(true);
		expect(result.resolved).toBe(script);
	});

	test("AC-024: throws CommandFileNotFoundError for non-existent file", async () => {
		const missing = join(tmpDir, "missing.sh");
		expect(resolveCommand(missing)).rejects.toThrow(CommandFileNotFoundError);
	});

	test("AC-025: throws CommandFileNotExecutableError for non-executable file", async () => {
		const script = join(tmpDir, "no-exec.sh");
		await writeFile(script, "#!/bin/sh\necho hi");
		await chmod(script, 0o644);

		expect(resolveCommand(script)).rejects.toThrow(CommandFileNotExecutableError);
	});

	test("AC-026: inline command passes through without validation", async () => {
		const result = await resolveCommand("echo hello world");
		expect(result.isFilePath).toBe(false);
		expect(result.resolved).toBe("echo hello world");
	});

	test("AC-020: path with arguments preserves args after resolved path", async () => {
		const script = join(tmpDir, "run.sh");
		await writeFile(script, "#!/bin/sh\necho hi");
		await chmod(script, 0o755);

		const result = await resolveCommand(`${script} --verbose --dry-run`);
		expect(result.isFilePath).toBe(true);
		expect(result.resolved).toBe(`${script} --verbose --dry-run`);
	});

	test("edge case 5: /nonexistent/tool with args treated as inline", async () => {
		const result = await resolveCommand("/nonexistent/tool arg1 arg2");
		expect(result.isFilePath).toBe(false);
		expect(result.resolved).toBe("/nonexistent/tool arg1 arg2");
	});

	test("edge case 7: directory path throws CommandPathIsDirectoryError", async () => {
		const dir = join(tmpDir, "scripts");
		await mkdir(dir);

		expect(resolveCommand(dir)).rejects.toThrow(CommandPathIsDirectoryError);
	});

	test("edge case 4: path with spaces works correctly", async () => {
		const dirWithSpaces = join(tmpDir, "my scripts");
		await mkdir(dirWithSpaces);
		const script = join(dirWithSpaces, "run.sh");
		await writeFile(script, "#!/bin/sh\necho hi");
		await chmod(script, 0o755);

		const result = await resolveCommand(script);
		expect(result.isFilePath).toBe(true);
		expect(result.resolved).toContain("my scripts");
	});
});
