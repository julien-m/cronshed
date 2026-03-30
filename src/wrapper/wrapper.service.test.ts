import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { WrapperService } from "./wrapper.service";
import { MAX_OUTPUT_BYTES } from "./wrapper.types";

describe("WrapperService", () => {
	let dataDir: string;
	let service: WrapperService;

	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), "cronshed-test-"));
		service = new WrapperService(dataDir);
	});

	afterEach(async () => {
		await rm(dataDir, { recursive: true, force: true });
	});

	describe("buildScript", () => {
		test("AC-051: produces bash script with shebang and correct command", () => {
			const script = service.buildScript({
				taskName: "backup-db",
				command: "/usr/local/bin/backup.sh",
				logPath: join(dataDir, "logs", "backup-db.jsonl"),
				maxOutputBytes: MAX_OUTPUT_BYTES,
			});

			expect(script).toStartWith("#!/bin/bash\n");
			expect(script).toContain("# cronshed wrapper for: backup-db");
			expect(script).toContain('/usr/local/bin/backup.sh >"$_stdout_file"');
		});

		test("AC-051: includes log path in script", () => {
			const logPath = join(dataDir, "logs", "my-task.jsonl");
			const script = service.buildScript({
				taskName: "my-task",
				command: "echo test",
				logPath,
				maxOutputBytes: MAX_OUTPUT_BYTES,
			});

			expect(script).toContain(`CRONSHED_LOG_FILE="${logPath}"`);
		});

		test("AC-061: includes truncation logic with max output bytes", () => {
			const script = service.buildScript({
				taskName: "test",
				command: "echo test",
				logPath: "/tmp/test.jsonl",
				maxOutputBytes: 10240,
			});

			expect(script).toContain("CRONSHED_MAX_OUTPUT=10240");
			expect(script).toContain("_truncate()");
			expect(script).toContain("head -c $CRONSHED_MAX_OUTPUT");
			expect(script).toContain("... [truncated]");
		});

		test("includes JSON escape function", () => {
			const script = service.buildScript({
				taskName: "test",
				command: "echo test",
				logPath: "/tmp/test.jsonl",
				maxOutputBytes: 10240,
			});

			expect(script).toContain("_json_escape()");
			expect(script).toContain("_stdout_json=$(_json_escape");
			expect(script).toContain("_stderr_json=$(_json_escape");
		});

		test("preserves exit code at end of script", () => {
			const script = service.buildScript({
				taskName: "test",
				command: "echo test",
				logPath: "/tmp/test.jsonl",
				maxOutputBytes: 10240,
			});

			expect(script).toContain("exit $_exit_code");
		});
	});

	describe("generate", () => {
		test("AC-050: creates wrapper file with 0755 permissions", async () => {
			await service.generate({ name: "backup-db", command: "echo hello" });

			const wrapperPath = service.getWrapperPath("backup-db");
			const fileStat = await stat(wrapperPath);
			expect(fileStat.isFile()).toBe(true);
			// Check executable permission (0o755 = rwxr-xr-x)
			expect(fileStat.mode & 0o777).toBe(0o755);
		});

		test("AC-062: creates wrappers directory if missing", async () => {
			await service.generate({ name: "test-task", command: "echo test" });

			const wrappersDir = join(dataDir, "wrappers");
			const dirStat = await stat(wrappersDir);
			expect(dirStat.isDirectory()).toBe(true);
		});

		test("returns the wrapper path", async () => {
			const path = await service.generate({ name: "my-task", command: "echo hi" });
			expect(path).toBe(service.getWrapperPath("my-task"));
		});

		test("overwrites existing wrapper on regeneration", async () => {
			await service.generate({ name: "task-a", command: "echo v1" });
			await service.generate({ name: "task-a", command: "echo v2" });

			const content = await Bun.file(service.getWrapperPath("task-a")).text();
			expect(content).toContain("echo v2");
			expect(content).not.toContain("# Command: echo v1");
		});
	});

	describe("remove", () => {
		test("AC-056: deletes wrapper file", async () => {
			await service.generate({ name: "task-a", command: "echo hello" });
			const wrapperPath = service.getWrapperPath("task-a");
			expect(await Bun.file(wrapperPath).exists()).toBe(true);

			await service.remove("task-a");
			expect(await Bun.file(wrapperPath).exists()).toBe(false);
		});

		test("AC-056: succeeds silently when wrapper is already missing", async () => {
			// Should not throw
			await service.remove("nonexistent-task");
		});
	});

	describe("syncWrappers", () => {
		test("AC-058: generates all wrappers", async () => {
			const tasks = [
				{ name: "task-a", command: "echo a" },
				{ name: "task-b", command: "echo b" },
			];

			await service.syncWrappers(tasks);

			expect(await Bun.file(service.getWrapperPath("task-a")).exists()).toBe(true);
			expect(await Bun.file(service.getWrapperPath("task-b")).exists()).toBe(true);
		});

		test("AC-058: removes orphaned wrappers", async () => {
			// Create an orphaned wrapper
			await service.generate({ name: "old-task", command: "echo old" });
			expect(await Bun.file(service.getWrapperPath("old-task")).exists()).toBe(true);

			// Sync with only new tasks
			await service.syncWrappers([{ name: "new-task", command: "echo new" }]);

			expect(await Bun.file(service.getWrapperPath("old-task")).exists()).toBe(false);
			expect(await Bun.file(service.getWrapperPath("new-task")).exists()).toBe(true);
		});

		test("AC-058: handles empty task list (removes all wrappers)", async () => {
			await service.generate({ name: "task-a", command: "echo a" });

			await service.syncWrappers([]);

			expect(await Bun.file(service.getWrapperPath("task-a")).exists()).toBe(false);
		});

		test("handles missing wrappers directory gracefully", async () => {
			// Should not throw when wrappers dir doesn't exist
			await service.syncWrappers([{ name: "task-a", command: "echo a" }]);
			expect(await Bun.file(service.getWrapperPath("task-a")).exists()).toBe(true);
		});
	});

	describe("getWrapperPath", () => {
		test("returns correct absolute path", () => {
			const path = service.getWrapperPath("backup-db");
			expect(path).toBe(join(dataDir, "wrappers", "backup-db.sh"));
		});
	});
});
