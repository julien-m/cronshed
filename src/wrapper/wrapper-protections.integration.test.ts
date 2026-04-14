// @spec FR-086: Flock integration, FR-090: Timeout integration, FR-091: timedOut — .specs/features/015-wrapper-protections/spec.md#fr-086

import { test, expect, describe, beforeEach, afterEach, beforeAll } from "bun:test";
import { join } from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { WrapperService, computeLockHash } from "./wrapper.service";

/** Check if a command is available on PATH. */
async function isToolAvailable(tool: string): Promise<boolean> {
	const result = await Bun.$`which ${tool}`.quiet().nothrow();
	return result.exitCode === 0;
}

describe("Wrapper Protections Integration", () => {
	let dataDir: string;
	let service: WrapperService;
	let hasFlockTool: boolean;
	let hasTimeoutTool: boolean;
	let timeoutToolName: string;

	beforeAll(async () => {
		hasFlockTool = await isToolAvailable("flock");
		const hasGtimeout = await isToolAvailable("gtimeout");
		const hasTimeout = await isToolAvailable("timeout");
		hasTimeoutTool = hasGtimeout || hasTimeout;
		timeoutToolName = hasGtimeout ? "gtimeout" : "timeout";
	});

	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), "cronshed-protection-test-"));
		service = new WrapperService(dataDir);
	});

	afterEach(async () => {
		await rm(dataDir, { recursive: true, force: true });
	});

	// @spec FR-086: Flock prevents concurrent execution — .specs/features/015-wrapper-protections/spec.md#fr-086
	describe("flock single-instance", () => {
		test("AC-075: second invocation is skipped while first holds lock", async () => {
			if (!hasFlockTool) {
				console.log("Skipping flock test: flock not available");
				return;
			}

			const configPath = join(dataDir, "tasks.json");
			await service.generate({
				name: "slow-task",
				command: "sleep 5",
				configPath,
			});

			const wrapperPath = service.getWrapperPath("slow-task");
			const logPath = join(dataDir, "logs", "slow-task.jsonl");

			// Start first invocation (holds lock with sleep 5)
			const proc1 = Bun.spawn(["bash", wrapperPath], {
				env: { ...process.env },
				stdout: "pipe",
				stderr: "pipe",
			});

			// Wait for flock to be acquired
			await Bun.sleep(500);

			// Start second invocation (should be skipped)
			const proc2 = Bun.spawn(["bash", wrapperPath], {
				env: { ...process.env },
				stdout: "pipe",
				stderr: "pipe",
			});

			const exitCode2 = await proc2.exited;
			expect(exitCode2).toBe(0);

			// Read log file and check for skip entry
			const logContent = await readFile(logPath, "utf-8");
			const entries = logContent.trim().split("\n").map((line) => JSON.parse(line));

			const skipEntry = entries.find((e: Record<string, unknown>) => e.skipped === true);
			expect(skipEntry).toBeDefined();
			expect(skipEntry.reason).toBe("already running");
			expect(skipEntry.exitCode).toBe(0);
			expect(skipEntry.skippedAt).toBeTruthy();

			proc1.kill();
			await proc1.exited;
		}, 15000);

		test("AC-077: lock is released after execution completes", async () => {
			if (!hasFlockTool) {
				console.log("Skipping flock test: flock not available");
				return;
			}

			const configPath = join(dataDir, "tasks.json");
			await service.generate({
				name: "quick-task",
				command: "echo done",
				configPath,
			});

			const wrapperPath = service.getWrapperPath("quick-task");

			const proc1 = Bun.spawn(["bash", wrapperPath], {
				env: { ...process.env },
				stdout: "pipe",
				stderr: "pipe",
			});
			await proc1.exited;

			const proc2 = Bun.spawn(["bash", wrapperPath], {
				env: { ...process.env },
				stdout: "pipe",
				stderr: "pipe",
			});
			const exitCode2 = await proc2.exited;
			expect(exitCode2).toBe(0);

			const logContent = await readFile(join(dataDir, "logs", "quick-task.jsonl"), "utf-8");
			const entries = logContent.trim().split("\n").map((line) => JSON.parse(line));
			expect(entries.length).toBe(2);
			expect(entries.every((e: Record<string, unknown>) => !e.skipped)).toBe(true);
		}, 10000);
	});

	// @spec FR-078: allowParallel disables flock — .specs/features/015-wrapper-protections/spec.md#fr-078
	describe("allow-parallel", () => {
		test("AC-078: both invocations execute when allowParallel is true", async () => {
			await service.generate({
				name: "parallel-task",
				command: "sleep 2",
				allowParallel: true,
			});

			const wrapperPath = service.getWrapperPath("parallel-task");

			const proc1 = Bun.spawn(["bash", wrapperPath], {
				env: { ...process.env },
				stdout: "pipe",
				stderr: "pipe",
			});
			const proc2 = Bun.spawn(["bash", wrapperPath], {
				env: { ...process.env },
				stdout: "pipe",
				stderr: "pipe",
			});

			await Promise.all([proc1.exited, proc2.exited]);

			const logContent = await readFile(join(dataDir, "logs", "parallel-task.jsonl"), "utf-8");
			const entries = logContent.trim().split("\n").map((line) => JSON.parse(line));
			expect(entries.length).toBe(2);
			expect(entries.every((e: Record<string, unknown>) => !e.skipped)).toBe(true);
		}, 10000);
	});

	// @spec FR-090: Timeout kills long-running command — .specs/features/015-wrapper-protections/spec.md#fr-090
	describe("timeout", () => {
		test("AC-080, AC-081: command killed after timeout, timedOut in log", async () => {
			if (!hasTimeoutTool) {
				console.log("Skipping timeout test: no timeout tool available");
				return;
			}

			await service.generate({
				name: "timeout-task",
				command: "sleep 60",
				allowParallel: true,
				timeout: "2s",
			});

			const wrapperPath = service.getWrapperPath("timeout-task");
			const proc = Bun.spawn(["bash", wrapperPath], {
				env: { ...process.env },
				stdout: "pipe",
				stderr: "pipe",
			});

			const exitCode = await proc.exited;
			expect(exitCode).toBe(124);

			const logContent = await readFile(join(dataDir, "logs", "timeout-task.jsonl"), "utf-8");
			const entry = JSON.parse(logContent.trim());
			expect(entry.exitCode).toBe(124);
			expect(entry.timedOut).toBe(true);
		}, 15000);

		test("AC-091: no timedOut when command completes within timeout", async () => {
			if (!hasTimeoutTool) {
				console.log("Skipping timeout test: no timeout tool available");
				return;
			}

			await service.generate({
				name: "fast-task",
				command: "echo done",
				allowParallel: true,
				timeout: "60s",
			});

			const wrapperPath = service.getWrapperPath("fast-task");
			const proc = Bun.spawn(["bash", wrapperPath], {
				env: { ...process.env },
				stdout: "pipe",
				stderr: "pipe",
			});

			const exitCode = await proc.exited;
			expect(exitCode).toBe(0);

			const logContent = await readFile(join(dataDir, "logs", "fast-task.jsonl"), "utf-8");
			const entry = JSON.parse(logContent.trim());
			expect(entry.exitCode).toBe(0);
			expect(entry.timedOut).toBeUndefined();
		}, 10000);
	});

	// @spec FR-086, FR-090: Combined flock + timeout — .specs/features/015-wrapper-protections/spec.md#fr-086
	describe("flock + timeout combined", () => {
		test("both protections work together", async () => {
			if (!hasFlockTool || !hasTimeoutTool) {
				console.log("Skipping combined test: flock or timeout tool not available");
				return;
			}

			const configPath = join(dataDir, "tasks.json");
			await service.generate({
				name: "combo-task",
				command: "sleep 60",
				configPath,
				timeout: "2s",
			});

			const wrapperPath = service.getWrapperPath("combo-task");

			const proc1 = Bun.spawn(["bash", wrapperPath], {
				env: { ...process.env },
				stdout: "pipe",
				stderr: "pipe",
			});

			await Bun.sleep(500);

			const proc2 = Bun.spawn(["bash", wrapperPath], {
				env: { ...process.env },
				stdout: "pipe",
				stderr: "pipe",
			});

			const exitCode2 = await proc2.exited;
			expect(exitCode2).toBe(0);

			const exitCode1 = await proc1.exited;
			expect(exitCode1).toBe(124);

			const logContent = await readFile(join(dataDir, "logs", "combo-task.jsonl"), "utf-8");
			const entries = logContent.trim().split("\n").map((line) => JSON.parse(line));

			const skipEntries = entries.filter((e: Record<string, unknown>) => e.skipped === true);
			const timeoutEntries = entries.filter((e: Record<string, unknown>) => e.timedOut === true);

			expect(skipEntries.length).toBeGreaterThanOrEqual(1);
			expect(timeoutEntries.length).toBeGreaterThanOrEqual(1);
		}, 15000);
	});

	// Test that wrappers without flock still work (graceful degradation)
	describe("graceful degradation", () => {
		test("wrapper executes normally even without flock available", async () => {
			const configPath = join(dataDir, "tasks.json");
			await service.generate({
				name: "normal-task",
				command: "echo hello",
				configPath,
			});

			const wrapperPath = service.getWrapperPath("normal-task");
			const proc = Bun.spawn(["bash", wrapperPath], {
				env: { ...process.env },
				stdout: "pipe",
				stderr: "pipe",
			});

			const exitCode = await proc.exited;
			expect(exitCode).toBe(0);

			const logContent = await readFile(join(dataDir, "logs", "normal-task.jsonl"), "utf-8");
			const entry = JSON.parse(logContent.trim());
			expect(entry.exitCode).toBe(0);
			expect(entry.stdout).toContain("hello");
		}, 10000);
	});

	describe("killRunningProcess", () => {
		test("kills a process launched via wrapper and cleans up lock file", async () => {
			if (!hasFlockTool) {
				console.log("Skipping kill test: flock not available");
				return;
			}

			const configPath = join(dataDir, "tasks.json");
			const wrapperPath = await service.generate({
				name: "long-task",
				command: "sleep 300",
				allowParallel: false,
				configPath,
			});

			// Spawn the wrapper
			const proc = Bun.spawn(["bash", wrapperPath], {
				env: { ...process.env },
				stdout: "pipe",
				stderr: "pipe",
			});

			// Wait for the process to start and write PID to lock file
			await new Promise((r) => setTimeout(r, 500));

			// Verify the lock file has a PID
			const hash = computeLockHash(configPath, "long-task");
			const lockFilePath = join(dataDir, "locks", `${hash}.lock`);
			const lockContent = await readFile(lockFilePath, "utf-8");
			const lockPid = parseInt(lockContent.trim(), 10);
			expect(lockPid).toBeGreaterThan(0);

			// Kill via service
			const killed = await service.killRunningProcess("long-task", configPath);
			expect(killed).toBe(true);

			// Wait for process to die
			await new Promise((r) => setTimeout(r, 200));

			// Verify wrapper process is dead
			let alive = false;
			try {
				process.kill(proc.pid, 0);
				alive = true;
			} catch {}
			expect(alive).toBe(false);

			// Lock file should be cleaned up
			expect(await Bun.file(lockFilePath).exists()).toBe(false);
		}, 10000);

		test("kills entire process tree including child processes", async () => {
			if (!hasFlockTool) {
				console.log("Skipping kill tree test: flock not available");
				return;
			}

			const configPath = join(dataDir, "tasks.json");
			const wrapperPath = await service.generate({
				name: "tree-task",
				command: 'bash -c "sleep 300"',
				allowParallel: false,
				configPath,
			});

			const proc = Bun.spawn(["bash", wrapperPath], {
				env: { ...process.env },
				stdout: "pipe",
				stderr: "pipe",
			});

			await new Promise((r) => setTimeout(r, 1000));

			// Find child PIDs before kill
			const pgrepResult = await Bun.$`pgrep -P ${proc.pid}`.quiet().nothrow();
			const childPids = pgrepResult
				.text()
				.trim()
				.split("\n")
				.filter(Boolean)
				.map((s) => parseInt(s, 10));
			expect(childPids.length).toBeGreaterThan(0);

			const killed = await service.killRunningProcess("tree-task", configPath);
			expect(killed).toBe(true);

			await new Promise((r) => setTimeout(r, 500));

			// Verify all descendants are dead
			for (const cpid of childPids) {
				let alive = false;
				try {
					process.kill(cpid, 0);
					alive = true;
				} catch {}
				expect(alive).toBe(false);
			}
		}, 10000);

		test("returns false when no process is running (no lock file)", async () => {
			const result = await service.killRunningProcess("no-such-task");
			expect(result).toBe(false);
		});
	});
});
