// @spec AC-050 through AC-062: Wrapper script integration tests — .specs/features/005-wrapper-script-generation/spec.md#ac-050

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ShellExecutor } from "../crontab/crontab.adapter";
import { CrontabAdapter } from "../crontab/crontab.adapter";
import type { CrontabEntry } from "../crontab/crontab.types";
import { SyncService } from "../crontab/sync.service";
import { TaskRepository } from "../task/task.repository";
import { TaskService } from "../task/task.service";
import { WrapperService } from "./wrapper.service";

/** In-memory crontab executor for testing. */
function createMemoryCrontab(initialContent: string = ""): ShellExecutor & { content: string } {
	const state = {
		content: initialContent,
		async exec(cmd: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
			const joined = cmd.join(" ");
			if (joined === "crontab -l") {
				if (state.content === "") {
					return { stdout: "", stderr: "crontab: no crontab for testuser", exitCode: 1 };
				}
				return { stdout: state.content, stderr: "", exitCode: 0 };
			}
			return { stdout: "", stderr: "unexpected command", exitCode: 127 };
		},
	};
	return state;
}

/** Create a test adapter with in-memory read/write. */
function createTestAdapter(initialContent: string = ""): CrontabAdapter & { getContent: () => string } {
	const memoryCrontab = createMemoryCrontab(initialContent);
	const adapter = new CrontabAdapter(memoryCrontab);

	const originalBuild = adapter.build.bind(adapter);
	adapter.write = async (userLines: string[], entries: CrontabEntry[]) => {
		memoryCrontab.content = originalBuild(userLines, entries);
	};

	return Object.assign(adapter, {
		getContent: () => memoryCrontab.content,
	});
}

describe("Wrapper Integration", () => {
	let dataDir: string;
	let repo: TaskRepository;
	let service: TaskService;
	let wrapperService: WrapperService;

	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), "cronshed-wrapper-test-"));
		const tasksPath = join(dataDir, "tasks.json");
		repo = new TaskRepository(tasksPath);
		service = new TaskService(repo);
		wrapperService = new WrapperService(dataDir);
	});

	afterEach(async () => {
		await rm(dataDir, { recursive: true, force: true });
	});

	describe("Wrapper generation on add (Story 1)", () => {
		test("AC-050: add generates wrapper with correct permissions", async () => {
			const task = await service.add({ name: "backup-db", schedule: "0 2 * * *", command: "echo backup" });
			await wrapperService.generate(task);

			const wrapperPath = wrapperService.getWrapperPath("backup-db");
			const fileStat = await stat(wrapperPath);
			expect(fileStat.isFile()).toBe(true);
			expect(fileStat.mode & 0o777).toBe(0o755);
		});

		test("AC-051: wrapper contains the task command", async () => {
			const task = await service.add({
				name: "cleanup-logs",
				schedule: "0 4 * * 0",
				command: "find /tmp -name '*.log' -delete",
			});
			await wrapperService.generate(task);

			const content = await Bun.file(wrapperService.getWrapperPath("cleanup-logs")).text();
			expect(content).toContain("find /tmp -name '*.log' -delete");
		});

		test("AC-051: wrapper logs to correct JSONL file", async () => {
			const task = await service.add({ name: "backup-db", schedule: "0 2 * * *", command: "echo test" });
			await wrapperService.generate(task);

			const content = await Bun.file(wrapperService.getWrapperPath("backup-db")).text();
			expect(content).toContain(join(dataDir, "logs", "backup-db.jsonl"));
		});

		test("AC-062: wrapper directories are created automatically", async () => {
			const task = await service.add({ name: "test-task", schedule: "* * * * *", command: "echo test" });
			await wrapperService.generate(task);

			const dirStat = await stat(join(dataDir, "wrappers"));
			expect(dirStat.isDirectory()).toBe(true);
		});
	});

	describe("Wrapper execution and logging (Story 2)", () => {
		test("AC-052: executing wrapper logs JSON entry with all fields", async () => {
			const task = await service.add({ name: "hello-task", schedule: "* * * * *", command: "echo hello" });
			await wrapperService.generate(task);
			// Ensure logs dir exists
			await mkdir(join(dataDir, "logs"), { recursive: true });

			const wrapperPath = wrapperService.getWrapperPath("hello-task");
			const proc = Bun.spawn(["bash", wrapperPath], { stdout: "pipe", stderr: "pipe" });
			await proc.exited;

			const logContent = await Bun.file(join(dataDir, "logs", "hello-task.jsonl")).text();
			const lines = logContent.trim().split("\n");
			expect(lines.length).toBe(1);

			const entry = JSON.parse(lines[0] ?? "");
			expect(entry.exitCode).toBe(0);
			expect(entry.stdout).toContain("hello");
			expect(entry.stderr).toBe("");
			expect(typeof entry.durationMs).toBe("number");
			expect(entry.durationMs).toBeGreaterThanOrEqual(0);
			expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
		});

		test("AC-053: wrapper exits with original command exit code on success", async () => {
			const task = await service.add({ name: "ok-task", schedule: "* * * * *", command: "true" });
			await wrapperService.generate(task);

			const wrapperPath = wrapperService.getWrapperPath("ok-task");
			const proc = Bun.spawn(["bash", wrapperPath], { stdout: "pipe", stderr: "pipe" });
			const exitCode = await proc.exited;
			expect(exitCode).toBe(0);
		});

		test("AC-053: wrapper exits with original command exit code on failure", async () => {
			const task = await service.add({ name: "fail-task", schedule: "* * * * *", command: "bash -c 'exit 42'" });
			await wrapperService.generate(task);

			const wrapperPath = wrapperService.getWrapperPath("fail-task");
			const proc = Bun.spawn(["bash", wrapperPath], { stdout: "pipe", stderr: "pipe" });
			const exitCode = await proc.exited;
			expect(exitCode).toBe(42);
		});

		test("AC-052: failed command logs correct exit code", async () => {
			const task = await service.add({ name: "fail-log", schedule: "* * * * *", command: "bash -c 'exit 7'" });
			await wrapperService.generate(task);

			const wrapperPath = wrapperService.getWrapperPath("fail-log");
			const proc = Bun.spawn(["bash", wrapperPath], { stdout: "pipe", stderr: "pipe" });
			await proc.exited;

			const logContent = await Bun.file(join(dataDir, "logs", "fail-log.jsonl")).text();
			const entry = JSON.parse(logContent.trim());
			expect(entry.exitCode).toBe(7);
		});

		test("AC-052: command with stderr is logged", async () => {
			const task = await service.add({
				name: "stderr-task",
				schedule: "* * * * *",
				command: "bash -c 'echo warning >&2'",
			});
			await wrapperService.generate(task);

			const wrapperPath = wrapperService.getWrapperPath("stderr-task");
			const proc = Bun.spawn(["bash", wrapperPath], { stdout: "pipe", stderr: "pipe" });
			await proc.exited;

			const logContent = await Bun.file(join(dataDir, "logs", "stderr-task.jsonl")).text();
			const entry = JSON.parse(logContent.trim());
			expect(entry.stderr).toContain("warning");
		});

		test("AC-062: log file created on first execution", async () => {
			const task = await service.add({ name: "first-run", schedule: "* * * * *", command: "echo first" });
			await wrapperService.generate(task);

			const logPath = join(dataDir, "logs", "first-run.jsonl");
			expect(await Bun.file(logPath).exists()).toBe(false);

			const wrapperPath = wrapperService.getWrapperPath("first-run");
			const proc = Bun.spawn(["bash", wrapperPath], { stdout: "pipe", stderr: "pipe" });
			await proc.exited;

			expect(await Bun.file(logPath).exists()).toBe(true);
		});

		test("multiple executions append to log", async () => {
			const task = await service.add({ name: "multi-run", schedule: "* * * * *", command: "echo run" });
			await wrapperService.generate(task);

			const wrapperPath = wrapperService.getWrapperPath("multi-run");

			// Run 3 times
			for (let i = 0; i < 3; i++) {
				const proc = Bun.spawn(["bash", wrapperPath], { stdout: "pipe", stderr: "pipe" });
				await proc.exited;
			}

			const logContent = await Bun.file(join(dataDir, "logs", "multi-run.jsonl")).text();
			const lines = logContent.trim().split("\n");
			expect(lines.length).toBe(3);

			// Each line should be valid JSON
			for (const line of lines) {
				const entry = JSON.parse(line);
				expect(entry.exitCode).toBe(0);
			}
		});
	});

	describe("Wrapper update on task change (Story 3)", () => {
		test("AC-054: update command regenerates wrapper", async () => {
			const task = await service.add({ name: "backup-db", schedule: "0 2 * * *", command: "echo v1" });
			await wrapperService.generate(task);

			const updated = await service.update("backup-db", { command: "echo v2" });
			await wrapperService.generate(updated);

			const content = await Bun.file(wrapperService.getWrapperPath("backup-db")).text();
			expect(content).toContain("echo v2");
			expect(content).not.toContain("# Command: echo v1");
		});

		test("AC-055: schedule-only update does not need wrapper regeneration", async () => {
			const task = await service.add({ name: "backup-db", schedule: "0 2 * * *", command: "echo original" });
			await wrapperService.generate(task);

			const _contentBefore = await Bun.file(wrapperService.getWrapperPath("backup-db")).text();

			// Update schedule only — wrapper should not need regeneration
			// (In the CLI handler, this is checked via values.command)
			await service.update("backup-db", { schedule: "0 3 * * *" });

			const contentAfter = await Bun.file(wrapperService.getWrapperPath("backup-db")).text();
			// Wrapper content should be unchanged since we didn't regenerate
			expect(contentAfter).toContain("echo original");
		});
	});

	describe("Wrapper cleanup on remove (Story 4)", () => {
		test("AC-056: remove deletes wrapper", async () => {
			const task = await service.add({ name: "backup-db", schedule: "0 2 * * *", command: "echo test" });
			await wrapperService.generate(task);
			expect(await Bun.file(wrapperService.getWrapperPath("backup-db")).exists()).toBe(true);

			await service.remove("backup-db");
			await wrapperService.remove("backup-db");
			expect(await Bun.file(wrapperService.getWrapperPath("backup-db")).exists()).toBe(false);
		});

		test("AC-056: remove succeeds when wrapper is already missing", async () => {
			await service.add({ name: "no-wrapper", schedule: "0 2 * * *", command: "echo test" });
			// Don't generate wrapper
			await service.remove("no-wrapper");
			await wrapperService.remove("no-wrapper"); // Should not throw
		});

		test("AC-057: log file is preserved when task is removed", async () => {
			const task = await service.add({ name: "logged-task", schedule: "* * * * *", command: "echo hi" });
			await wrapperService.generate(task);

			// Execute wrapper to create log
			const wrapperPath = wrapperService.getWrapperPath("logged-task");
			const proc = Bun.spawn(["bash", wrapperPath], { stdout: "pipe", stderr: "pipe" });
			await proc.exited;

			const logPath = join(dataDir, "logs", "logged-task.jsonl");
			expect(await Bun.file(logPath).exists()).toBe(true);

			// Remove task and wrapper
			await service.remove("logged-task");
			await wrapperService.remove("logged-task");

			// Log file should still exist
			expect(await Bun.file(logPath).exists()).toBe(true);
		});
	});

	describe("Sync regenerates wrappers (Story 5)", () => {
		test("AC-058: sync regenerates missing wrappers", async () => {
			await service.add({ name: "task-a", schedule: "0 1 * * *", command: "echo a" });
			await service.add({ name: "task-b", schedule: "0 2 * * *", command: "echo b" });

			const adapter = createTestAdapter();
			const syncService = new SyncService(repo, adapter, wrapperService);

			await syncService.sync();

			expect(await Bun.file(wrapperService.getWrapperPath("task-a")).exists()).toBe(true);
			expect(await Bun.file(wrapperService.getWrapperPath("task-b")).exists()).toBe(true);
		});

		test("AC-058: sync removes orphaned wrappers", async () => {
			// Create an orphaned wrapper
			await wrapperService.generate({ name: "old-task", command: "echo old" });
			expect(await Bun.file(wrapperService.getWrapperPath("old-task")).exists()).toBe(true);

			// Add only new tasks
			await service.add({ name: "new-task", schedule: "* * * * *", command: "echo new" });

			const adapter = createTestAdapter();
			const syncService = new SyncService(repo, adapter, wrapperService);

			await syncService.sync();

			expect(await Bun.file(wrapperService.getWrapperPath("old-task")).exists()).toBe(false);
			expect(await Bun.file(wrapperService.getWrapperPath("new-task")).exists()).toBe(true);
		});

		test("AC-060: crontab entries use wrapper path", async () => {
			await service.add({ name: "backup-db", schedule: "0 2 * * *", command: "/usr/local/bin/backup.sh" });

			const adapter = createTestAdapter();
			const syncService = new SyncService(repo, adapter, wrapperService);

			await syncService.sync();

			const crontabContent = adapter.getContent();
			const wrapperPath = wrapperService.getWrapperPath("backup-db");
			expect(crontabContent).toContain(wrapperPath);
			expect(crontabContent).not.toContain("/usr/local/bin/backup.sh");
		});

		test("AC-059: dry-run does not create wrappers", async () => {
			await service.add({ name: "no-wrapper", schedule: "* * * * *", command: "echo test" });

			const adapter = createTestAdapter();
			const syncService = new SyncService(repo, adapter, wrapperService);

			await syncService.sync({ dryRun: true });

			expect(await Bun.file(wrapperService.getWrapperPath("no-wrapper")).exists()).toBe(false);
		});

		test("sync without wrapperService uses raw commands (backward compat)", async () => {
			await service.add({ name: "raw-task", schedule: "0 1 * * *", command: "/usr/bin/raw-cmd" });

			const adapter = createTestAdapter();
			const syncService = new SyncService(repo, adapter); // No wrapperService

			await syncService.sync();

			const crontabContent = adapter.getContent();
			expect(crontabContent).toContain("/usr/bin/raw-cmd");
		});
	});

	describe("Output truncation (Story 6)", () => {
		test("AC-061: stdout truncated at 10KB", async () => {
			// Create a command that outputs more than 10KB
			// 'yes' prints "y\n" repeatedly — we use head to get exactly 20KB
			const task = await service.add({
				name: "big-stdout",
				schedule: "* * * * *",
				command: "head -c 20480 /dev/urandom | base64",
			});
			await wrapperService.generate(task);

			const wrapperPath = wrapperService.getWrapperPath("big-stdout");
			const proc = Bun.spawn(["bash", wrapperPath], { stdout: "pipe", stderr: "pipe" });
			await proc.exited;

			const logContent = await Bun.file(join(dataDir, "logs", "big-stdout.jsonl")).text();
			const entry = JSON.parse(logContent.trim());

			// Stdout should be truncated — check for the truncation marker
			expect(entry.stdout).toContain("... [truncated]");
		});

		test("AC-061: small output is not truncated", async () => {
			const task = await service.add({
				name: "small-output",
				schedule: "* * * * *",
				command: "echo small",
			});
			await wrapperService.generate(task);

			const wrapperPath = wrapperService.getWrapperPath("small-output");
			const proc = Bun.spawn(["bash", wrapperPath], { stdout: "pipe", stderr: "pipe" });
			await proc.exited;

			const logContent = await Bun.file(join(dataDir, "logs", "small-output.jsonl")).text();
			const entry = JSON.parse(logContent.trim());

			expect(entry.stdout).toBe("small");
			expect(entry.stdout).not.toContain("truncated");
		});
	});

	// @spec AC-063, AC-064, AC-065: Failure notification integration tests — .specs/features/008-failure-notifications/spec.md#ac-063
	describe("Failure notification (Story 1 — 008)", () => {
		test("AC-063: wrapper calls cc-hub on failure when notify enabled", async () => {
			// Create a mock cc-hub that records its arguments
			const mockBinDir = join(dataDir, "mock-bin");
			await mkdir(mockBinDir, { recursive: true });
			const mockCallLog = join(dataDir, "cc-hub-calls.log");
			const mockCcHub = join(mockBinDir, "cc-hub");
			await Bun.write(mockCcHub, `#!/bin/bash\necho "$@" >> "${mockCallLog}"\n`);
			const { chmod } = await import("node:fs/promises");
			await chmod(mockCcHub, 0o755);

			// Create a failing script
			const failScript = join(dataDir, "fail.sh");
			await Bun.write(failScript, "#!/bin/bash\necho 'connection refused' >&2\nexit 1\n");
			await chmod(failScript, 0o755);

			const task = await service.add({
				name: "notify-fail",
				schedule: "0 2 * * *",
				command: failScript,
				notify: true,
			});
			await wrapperService.generate(task);

			const wrapperPath = wrapperService.getWrapperPath("notify-fail");
			const proc = Bun.spawn(["bash", wrapperPath], {
				stdout: "pipe",
				stderr: "pipe",
				env: { ...process.env, PATH: `${mockBinDir}:${process.env.PATH}` },
			});
			await proc.exited;

			// Verify cc-hub was called
			const calls = await Bun.file(mockCallLog).text();
			expect(calls).toContain("telegram send");
			expect(calls).toContain("notify-fail");
			expect(calls).toContain("exit code");
		});

		test("AC-064: wrapper does NOT call cc-hub on success when notify enabled", async () => {
			const mockBinDir = join(dataDir, "mock-bin");
			await mkdir(mockBinDir, { recursive: true });
			const mockCallLog = join(dataDir, "cc-hub-calls.log");
			const mockCcHub = join(mockBinDir, "cc-hub");
			await Bun.write(mockCcHub, `#!/bin/bash\necho "$@" >> "${mockCallLog}"\n`);
			const { chmod } = await import("node:fs/promises");
			await chmod(mockCcHub, 0o755);

			const task = await service.add({
				name: "notify-success",
				schedule: "0 2 * * *",
				command: "echo ok",
				notify: true,
			});
			await wrapperService.generate(task);

			const wrapperPath = wrapperService.getWrapperPath("notify-success");
			const proc = Bun.spawn(["bash", wrapperPath], {
				stdout: "pipe",
				stderr: "pipe",
				env: { ...process.env, PATH: `${mockBinDir}:${process.env.PATH}` },
			});
			await proc.exited;

			// cc-hub should NOT have been called
			const logExists = await Bun.file(mockCallLog).exists();
			expect(logExists).toBe(false);
		});

		test("AC-065: wrapper skips notification when cc-hub not in PATH", async () => {
			// Create a failing script
			const failScript = join(dataDir, "fail2.sh");
			await Bun.write(failScript, "#!/bin/bash\nexit 1\n");
			const { chmod } = await import("node:fs/promises");
			await chmod(failScript, 0o755);

			const task = await service.add({
				name: "notify-no-cchub",
				schedule: "0 2 * * *",
				command: failScript,
				notify: true,
			});
			await wrapperService.generate(task);

			const wrapperPath = wrapperService.getWrapperPath("notify-no-cchub");
			// Use a stripped PATH without cc-hub
			const proc = Bun.spawn(["bash", wrapperPath], {
				stdout: "pipe",
				stderr: "pipe",
				env: { ...process.env, PATH: "/usr/bin:/bin" },
			});
			const exitCode = await proc.exited;

			// Should exit with 1 (the command's exit code), not crash
			expect(exitCode).toBe(1);

			// Log should still be recorded
			const logContent = await Bun.file(join(dataDir, "logs", "notify-no-cchub.jsonl")).text();
			const entry = JSON.parse(logContent.trim());
			expect(entry.exitCode).toBe(1);
		});

		test("AC-067: wrapper does NOT include notification block when notify is false", async () => {
			const task = await service.add({
				name: "no-notify",
				schedule: "0 2 * * *",
				command: "/bin/false",
				notify: false,
			});
			await wrapperService.generate(task);

			const wrapperPath = wrapperService.getWrapperPath("no-notify");
			const script = await Bun.file(wrapperPath).text();
			expect(script).not.toContain("cc-hub");
			expect(script).not.toContain("Failure notification");
		});
	});
});
