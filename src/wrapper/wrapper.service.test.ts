import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TimeoutToolMissingError } from "./wrapper.errors";
import { computeLockHash, detectTimeoutTool, WrapperService } from "./wrapper.service";
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
				notify: false,
				allowParallel: false,
			});

			expect(script).toStartWith("#!/bin/bash\n");
			expect(script).toContain("# cronshed wrapper for: backup-db");
			expect(script).toContain("/usr/local/bin/backup.sh");
		});

		test("AC-051: includes log path in script", () => {
			const logPath = join(dataDir, "logs", "my-task.jsonl");
			const script = service.buildScript({
				taskName: "my-task",
				command: "echo test",
				logPath,
				maxOutputBytes: MAX_OUTPUT_BYTES,
				notify: false,
				allowParallel: true,
			});

			expect(script).toContain(`CRONSHED_LOG_FILE="${logPath}"`);
		});

		test("AC-061: includes truncation logic with max output bytes", () => {
			const script = service.buildScript({
				taskName: "test",
				command: "echo test",
				logPath: "/tmp/test.jsonl",
				maxOutputBytes: 10240,
				notify: false,
				allowParallel: true,
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
				notify: false,
				allowParallel: true,
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
				notify: false,
				allowParallel: true,
			});

			expect(script).toContain("exit $_exit_code");
		});

		// @spec FR-048: Notification block in wrapper — .specs/features/008-failure-notifications/spec.md#fr-048
		test("AC-063: includes notification block when notify is true", () => {
			const script = service.buildScript({
				taskName: "backup-db",
				command: "echo test",
				logPath: "/tmp/test.jsonl",
				maxOutputBytes: MAX_OUTPUT_BYTES,
				notify: true,
				allowParallel: true,
			});

			expect(script).toContain("# --- Failure notification ---");
			expect(script).toContain("cc-hub telegram send");
			expect(script).toContain("backup-db");
			expect(script).toContain("command -v cc-hub");
		});

		test("AC-064: does NOT include notification block when notify is false", () => {
			const script = service.buildScript({
				taskName: "backup-db",
				command: "echo test",
				logPath: "/tmp/test.jsonl",
				maxOutputBytes: MAX_OUTPUT_BYTES,
				notify: false,
				allowParallel: true,
			});

			expect(script).not.toContain("# --- Failure notification ---");
			expect(script).not.toContain("cc-hub telegram send");
		});

		// @spec FR-049: Stderr truncation for notification — .specs/features/008-failure-notifications/spec.md#fr-049
		test("AC-070: notification block truncates stderr to 500 chars", () => {
			const script = service.buildScript({
				taskName: "test-task",
				command: "echo test",
				logPath: "/tmp/test.jsonl",
				maxOutputBytes: MAX_OUTPUT_BYTES,
				notify: true,
				allowParallel: true,
			});

			expect(script).toContain("head -c 500");
		});

		test("AC-071: notification uses 'no stderr output' when stderr is empty", () => {
			const script = service.buildScript({
				taskName: "test-task",
				command: "echo test",
				logPath: "/tmp/test.jsonl",
				maxOutputBytes: MAX_OUTPUT_BYTES,
				notify: true,
				allowParallel: true,
			});

			expect(script).toContain("no stderr output");
		});

		// @spec FR-048: Notification block checks cc-hub availability — .specs/features/008-failure-notifications/spec.md#fr-048
		test("AC-065: notification block checks cc-hub availability before sending", () => {
			const script = service.buildScript({
				taskName: "test-task",
				command: "echo test",
				logPath: "/tmp/test.jsonl",
				maxOutputBytes: MAX_OUTPUT_BYTES,
				notify: true,
				allowParallel: true,
			});

			expect(script).toContain("command -v cc-hub >/dev/null 2>&1");
		});

		test("notification block is inserted before temp file cleanup", () => {
			const script = service.buildScript({
				taskName: "test-task",
				command: "echo test",
				logPath: "/tmp/test.jsonl",
				maxOutputBytes: MAX_OUTPUT_BYTES,
				notify: true,
				allowParallel: true,
			});

			const notifyIdx = script.indexOf("# --- Failure notification ---");
			const cleanupIdx = script.indexOf('rm -f "$_stdout_file"');
			expect(notifyIdx).toBeGreaterThan(-1);
			expect(cleanupIdx).toBeGreaterThan(notifyIdx);
		});

		// @spec FR-086: Flock block in wrapper — .specs/features/015-wrapper-protections/spec.md#fr-086
		test("AC-075: includes flock block when allowParallel is false", () => {
			const script = service.buildScript({
				taskName: "backup-db",
				command: "echo test",
				logPath: "/tmp/test.jsonl",
				maxOutputBytes: MAX_OUTPUT_BYTES,
				notify: false,
				allowParallel: false,
				lockFilePath: "$CRONSHED_LOCK_DIR/abc123.lock",
				locksDir: "/tmp/locks",
				flockPath: "/usr/bin/flock",
			});

			expect(script).toContain("/usr/bin/flock -n 9");
			expect(script).toContain("CRONSHED_LOCK_DIR=");
			expect(script).toContain('mkdir -p "$CRONSHED_LOCK_DIR"');
			expect(script).toContain('echo $$ > "$CRONSHED_LOCK_FILE"');
			expect(script).toContain(') 9>"$CRONSHED_LOCK_FILE"');
		});

		// @spec FR-078: No flock when allowParallel — .specs/features/015-wrapper-protections/spec.md#fr-078
		test("AC-078: does NOT include flock block when allowParallel is true", () => {
			const script = service.buildScript({
				taskName: "health-check",
				command: "curl http://localhost",
				logPath: "/tmp/test.jsonl",
				maxOutputBytes: MAX_OUTPUT_BYTES,
				notify: false,
				allowParallel: true,
			});

			expect(script).not.toContain("flock");
			expect(script).not.toContain("CRONSHED_LOCK_DIR");
		});

		// @spec FR-090: Timeout wrapping in wrapper — .specs/features/015-wrapper-protections/spec.md#fr-090
		test("AC-080: includes timeout wrapping when timeout is configured", () => {
			const script = service.buildScript({
				taskName: "slow-job",
				command: "make build",
				logPath: "/tmp/test.jsonl",
				maxOutputBytes: MAX_OUTPUT_BYTES,
				notify: false,
				allowParallel: true,
				timeout: { seconds: 300, tool: "gtimeout" },
			});

			expect(script).toContain('CRONSHED_TIMEOUT_CMD="gtimeout"');
			expect(script).toContain("CRONSHED_TIMEOUT_SECS=300");
			expect(script).toContain("$CRONSHED_TIMEOUT_CMD --foreground $CRONSHED_TIMEOUT_SECS make build");
		});

		test("does NOT include timeout wrapping when no timeout", () => {
			const script = service.buildScript({
				taskName: "fast-job",
				command: "echo done",
				logPath: "/tmp/test.jsonl",
				maxOutputBytes: MAX_OUTPUT_BYTES,
				notify: false,
				allowParallel: true,
			});

			expect(script).toContain('CRONSHED_TIMEOUT_CMD=""');
			expect(script).toContain("CRONSHED_TIMEOUT_SECS=0");
		});

		// @spec FR-091: timedOut field in log entry — .specs/features/015-wrapper-protections/spec.md#fr-091
		test("AC-081: includes timedOut check when timeout is configured", () => {
			const script = service.buildScript({
				taskName: "slow-job",
				command: "make build",
				logPath: "/tmp/test.jsonl",
				maxOutputBytes: MAX_OUTPUT_BYTES,
				notify: false,
				allowParallel: true,
				timeout: { seconds: 60, tool: "timeout" },
			});

			expect(script).toContain('"timedOut":true');
			expect(script).toContain('$_exit_code" -eq 124');
		});

		test("AC-091: no timedOut check when no timeout configured", () => {
			const script = service.buildScript({
				taskName: "fast-job",
				command: "echo done",
				logPath: "/tmp/test.jsonl",
				maxOutputBytes: MAX_OUTPUT_BYTES,
				notify: false,
				allowParallel: true,
			});

			expect(script).not.toContain("timedOut");
		});

		test("flock + timeout combined: both blocks present", () => {
			const script = service.buildScript({
				taskName: "combo-job",
				command: "make build",
				logPath: "/tmp/test.jsonl",
				maxOutputBytes: MAX_OUTPUT_BYTES,
				notify: false,
				allowParallel: false,
				lockFilePath: "$CRONSHED_LOCK_DIR/abc.lock",
				locksDir: "/tmp/locks",
				timeout: { seconds: 120, tool: "gtimeout" },
				flockPath: "/usr/bin/flock",
			});

			expect(script).toContain("/usr/bin/flock -n 9");
			expect(script).toContain("$CRONSHED_TIMEOUT_CMD --foreground $CRONSHED_TIMEOUT_SECS make build");
			expect(script).toContain('"timedOut":true');
		});

		// @spec FR-087: Skip log entry format — .specs/features/015-wrapper-protections/spec.md#fr-087
		test("AC-076: flock skip entry has correct fields", () => {
			const script = service.buildScript({
				taskName: "backup-db",
				command: "echo test",
				logPath: "/tmp/test.jsonl",
				maxOutputBytes: MAX_OUTPUT_BYTES,
				notify: false,
				allowParallel: false,
				lockFilePath: "$CRONSHED_LOCK_DIR/abc.lock",
				locksDir: "/tmp/locks",
				flockPath: "/usr/bin/flock",
			});

			expect(script).toContain('"skipped":true');
			expect(script).toContain('"reason":"already running"');
			expect(script).toContain('"pidHolder":%s');
			expect(script).toContain("lsof -t");
		});
	});

	describe("generate", () => {
		test("AC-050: creates wrapper file with 0755 permissions", async () => {
			await service.generate({ name: "backup-db", command: "echo hello" });

			const wrapperPath = service.getWrapperPath("backup-db");
			const fileStat = await stat(wrapperPath);
			expect(fileStat.isFile()).toBe(true);
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

		// @spec FR-050: Generate passes notify to buildScript — .specs/features/008-failure-notifications/spec.md#fr-050
		test("AC-063: generate with notify=true includes notification block", async () => {
			await service.generate({ name: "notify-task", command: "echo test", notify: true });

			const content = await Bun.file(service.getWrapperPath("notify-task")).text();
			expect(content).toContain("cc-hub telegram send");
			expect(content).toContain("notify-task");
		});

		test("AC-064: generate with notify=false excludes notification block", async () => {
			await service.generate({ name: "silent-task", command: "echo test", notify: false });

			const content = await Bun.file(service.getWrapperPath("silent-task")).text();
			expect(content).not.toContain("cc-hub telegram send");
		});

		test("generate defaults notify to false when not provided", async () => {
			await service.generate({ name: "default-task", command: "echo test" });

			const content = await Bun.file(service.getWrapperPath("default-task")).text();
			expect(content).not.toContain("cc-hub telegram send");
		});

		// @spec FR-086: Generate includes flock by default — .specs/features/015-wrapper-protections/spec.md#fr-086
		test("AC-075: generated wrapper includes flock block by default", async () => {
			await service.generate({ name: "backup-db", command: "echo test" });

			const content = await Bun.file(service.getWrapperPath("backup-db")).text();
			expect(content).toContain("flock -n 9");
			expect(content).toContain("CRONSHED_LOCK_DIR");
		});

		test("AC-078: generated wrapper without flock when allowParallel=true", async () => {
			await service.generate({ name: "health-check", command: "echo test", allowParallel: true });

			const content = await Bun.file(service.getWrapperPath("health-check")).text();
			expect(content).not.toContain("flock");
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
			await service.generate({ name: "old-task", command: "echo old" });
			expect(await Bun.file(service.getWrapperPath("old-task")).exists()).toBe(true);

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
			await service.syncWrappers([{ name: "task-a", command: "echo a" }]);
			expect(await Bun.file(service.getWrapperPath("task-a")).exists()).toBe(true);
		});

		// @spec FR-053: Sync passes notify per task — .specs/features/008-failure-notifications/spec.md#fr-053
		test("AC-072: sync generates wrappers with correct notify state per task", async () => {
			await service.syncWrappers([
				{ name: "notify-task", command: "echo a", notify: true },
				{ name: "silent-task", command: "echo b", notify: false },
			]);

			const notifyContent = await Bun.file(service.getWrapperPath("notify-task")).text();
			const silentContent = await Bun.file(service.getWrapperPath("silent-task")).text();

			expect(notifyContent).toContain("cc-hub telegram send");
			expect(silentContent).not.toContain("cc-hub telegram send");
		});
	});

	describe("getWrapperPath", () => {
		test("returns correct absolute path", () => {
			const path = service.getWrapperPath("backup-db");
			expect(path).toBe(join(dataDir, "wrappers", "backup-db.sh"));
		});
	});

	// @spec FR-089: Timeout tool blocking error — .specs/features/015-wrapper-protections/spec.md#fr-089
	describe("detectTimeoutTool", () => {
		test("AC-082: throws TimeoutToolMissingError when no timeout tool available", async () => {
			// Save original PATH and set to empty dir so neither gtimeout nor timeout is found
			const emptyDir = await mkdtemp(join(tmpdir(), "cronshed-empty-path-"));
			const origPath = process.env.PATH;
			process.env.PATH = emptyDir;

			try {
				await expect(detectTimeoutTool()).rejects.toThrow("timeout");
				// Also verify it throws the correct error type
				try {
					await detectTimeoutTool();
				} catch (err: unknown) {
					expect(err).toBeInstanceOf(TimeoutToolMissingError);
					expect((err as Error).message).toContain("brew install coreutils");
				}
			} finally {
				process.env.PATH = origPath;
				await rm(emptyDir, { recursive: true, force: true });
			}
		});

		test("AC-092: auto-timeout from ratio requires timeout tool (same blocking error)", async () => {
			// When generate() is called with a timeout string but no tool is available,
			// it must throw TimeoutToolMissingError — same error whether explicit or ratio-derived.
			const emptyDir = await mkdtemp(join(tmpdir(), "cronshed-empty-path-"));
			const origPath = process.env.PATH;
			process.env.PATH = emptyDir;

			try {
				await expect(service.generate({ name: "ratio-task", command: "echo hi", timeout: "30s" })).rejects.toThrow(
					"timeout",
				);
			} finally {
				process.env.PATH = origPath;
				await rm(emptyDir, { recursive: true, force: true });
			}
		});
	});

	// @spec FR-094: Auto-timeout from ratio — .specs/features/015-wrapper-protections/spec.md#fr-094
	describe("buildScript — timeout from ratio", () => {
		test("AC-086: wrapper gets auto-computed timeout (schedule interval x ratio)", () => {
			// Simulating ratio 0.8 on */5 * * * * (300s interval) -> 240s timeout
			const script = service.buildScript({
				taskName: "ratio-task",
				command: "make build",
				logPath: "/tmp/test.jsonl",
				maxOutputBytes: MAX_OUTPUT_BYTES,
				notify: false,
				allowParallel: true,
				timeout: { seconds: 240, tool: "gtimeout" },
			});

			expect(script).toContain("CRONSHED_TIMEOUT_SECS=240");
			expect(script).toContain('CRONSHED_TIMEOUT_CMD="gtimeout"');
			expect(script).toContain("$CRONSHED_TIMEOUT_CMD --foreground $CRONSHED_TIMEOUT_SECS make build");
		});

		test("AC-087: explicit --timeout takes precedence over default-timeout-ratio", () => {
			// Explicit 30s should appear in the wrapper, NOT a ratio-derived value
			const script = service.buildScript({
				taskName: "explicit-task",
				command: "make build",
				logPath: "/tmp/test.jsonl",
				maxOutputBytes: MAX_OUTPUT_BYTES,
				notify: false,
				allowParallel: true,
				timeout: { seconds: 30, tool: "gtimeout" },
			});

			expect(script).toContain("CRONSHED_TIMEOUT_SECS=30");
			expect(script).not.toContain("CRONSHED_TIMEOUT_SECS=240");
			expect(script).toContain("$CRONSHED_TIMEOUT_CMD --foreground $CRONSHED_TIMEOUT_SECS make build");
		});

		test("AC-086: minimum auto-timeout is 10s (ratio yields less than 10)", () => {
			// If ratio yields 8s, it should be clamped to 10s at the handler level.
			// The wrapper receives the final computed value.
			const script = service.buildScript({
				taskName: "min-timeout-task",
				command: "echo fast",
				logPath: "/tmp/test.jsonl",
				maxOutputBytes: MAX_OUTPUT_BYTES,
				notify: false,
				allowParallel: true,
				timeout: { seconds: 10, tool: "timeout" },
			});

			expect(script).toContain("CRONSHED_TIMEOUT_SECS=10");
			expect(script).toContain('CRONSHED_TIMEOUT_CMD="timeout"');
		});
	});

	describe("killRunningProcess", () => {
		test("returns false when lock file does not exist", async () => {
			const result = await service.killRunningProcess("nonexistent-task");
			expect(result).toBe(false);
		});

		test("returns false and cleans up stale lock file when PID is alive but flock is free", async () => {
			const locksDir = join(dataDir, "locks");
			await mkdir(locksDir, { recursive: true });
			const hash = computeLockHash(join(dataDir, "tasks.json"), "stale-live-pid-task");
			const lockFile = join(locksDir, `${hash}.lock`);
			await writeFile(lockFile, `${process.pid}\n`);

			const result = await service.killRunningProcess("stale-live-pid-task");
			expect(result).toBe(false);
			expect(await Bun.file(lockFile).exists()).toBe(false);
			expect(() => process.kill(process.pid, 0)).not.toThrow();
		});

		test("returns false and cleans up lock file with invalid PID", async () => {
			const locksDir = join(dataDir, "locks");
			await mkdir(locksDir, { recursive: true });
			const hash = computeLockHash(join(dataDir, "tasks.json"), "bad-pid-task");
			const lockFile = join(locksDir, `${hash}.lock`);
			await writeFile(lockFile, "not-a-number\n");

			const result = await service.killRunningProcess("bad-pid-task");
			expect(result).toBe(false);
			expect(await Bun.file(lockFile).exists()).toBe(false);
		});

		test("returns false for stale PID (process not running)", async () => {
			const locksDir = join(dataDir, "locks");
			await mkdir(locksDir, { recursive: true });
			const hash = computeLockHash(join(dataDir, "tasks.json"), "stale-task");
			const lockFile = join(locksDir, `${hash}.lock`);
			// Use a very high PID that almost certainly doesn't exist
			await writeFile(lockFile, "9999999\n");

			const result = await service.killRunningProcess("stale-task");
			expect(result).toBe(false);
			expect(await Bun.file(lockFile).exists()).toBe(false);
		});
	});

	// @spec FR-098: Lock hash computation — .specs/features/015-wrapper-protections/spec.md#fr-098
	describe("computeLockHash", () => {
		test("AC-089: produces hex string", () => {
			const hash = computeLockHash("/home/user/.cronshed/tasks.json", "backup");
			expect(hash).toMatch(/^[a-f0-9]{64}$/);
		});

		test("AC-089: same task name with different config paths produces different hashes", () => {
			const hashA = computeLockHash("/home/user/project-a/tasks.json", "backup");
			const hashB = computeLockHash("/home/user/project-b/tasks.json", "backup");
			expect(hashA).not.toBe(hashB);
		});

		test("same config path with different task names produces different hashes", () => {
			const hash1 = computeLockHash("/home/user/tasks.json", "task-a");
			const hash2 = computeLockHash("/home/user/tasks.json", "task-b");
			expect(hash1).not.toBe(hash2);
		});

		test("deterministic for same input", () => {
			const hash1 = computeLockHash("/path/tasks.json", "my-task");
			const hash2 = computeLockHash("/path/tasks.json", "my-task");
			expect(hash1).toBe(hash2);
		});
	});
});
