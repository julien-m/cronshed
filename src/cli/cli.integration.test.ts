import { test, expect, describe, beforeEach } from "bun:test";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";

const CLI = join(import.meta.dir, "../../index.ts");

let tmpDir: string;
let env: Record<string, string>;

beforeEach(async () => {
	tmpDir = await mkdtemp(join(tmpdir(), "cronshed-cli-test-"));
	env = { ...process.env, CRONSHED_HOME: tmpDir } as Record<string, string>;
});

async function run(...args: string[]) {
	const proc = Bun.spawn(["bun", CLI, ...args], {
		env,
		stdout: "pipe",
		stderr: "pipe",
	});

	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	const exitCode = await proc.exited;

	return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

describe("cronshed add", () => {
	test("AC-001: creates a task successfully", async () => {
		const { stdout, exitCode } = await run("add", "backup-db", "--schedule", "0 2 * * *", "--command", "echo hi");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Task backup-db created");
	});

	test("AC-002: rejects invalid cron with exit code 2", async () => {
		const { stderr, exitCode } = await run("add", "bad-cron", "--schedule", "bad", "--command", "echo hi");
		expect(exitCode).toBe(2);
		expect(stderr).toContain('Invalid cron expression "bad"');
		expect(stderr).toContain("Expected format");
	});

	test("AC-003: rejects duplicate name with exit code 1", async () => {
		await run("add", "my-task", "--schedule", "0 0 * * *", "--command", "echo hi");
		const { stderr, exitCode } = await run("add", "my-task", "--schedule", "0 1 * * *", "--command", "echo dup");
		expect(exitCode).toBe(1);
		expect(stderr).toContain('Task "my-task" already exists');
	});

	test("AC-017: rejects missing task name with exit code 2", async () => {
		const { stderr, exitCode } = await run("add");
		expect(exitCode).toBe(2);
		expect(stderr).toContain("Missing task name");
		expect(stderr).toContain("Usage:");
	});
});

describe("cronshed list", () => {
	test("AC-005: displays tasks in a table", async () => {
		await run("add", "task-a", "--schedule", "0 0 * * *", "--command", "echo a");
		await run("add", "task-b", "--schedule", "0 1 * * *", "--command", "echo b");

		const { stdout, exitCode } = await run("list");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("task-a");
		expect(stdout).toContain("task-b");
		expect(stdout).toContain("NAME");
	});

	test("AC-006: outputs JSON array", async () => {
		await run("add", "task-a", "--schedule", "0 0 * * *", "--command", "echo a");
		const { stdout, exitCode } = await run("list", "--json");
		expect(exitCode).toBe(0);
		const parsed = JSON.parse(stdout);
		expect(Array.isArray(parsed)).toBe(true);
		expect(parsed[0].name).toBe("task-a");
	});

	test("AC-007: shows message when no tasks", async () => {
		const { stdout, exitCode } = await run("list");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("No tasks configured");
	});

	test("list --json returns [] when empty", async () => {
		const { stdout, exitCode } = await run("list", "--json");
		expect(exitCode).toBe(0);
		expect(JSON.parse(stdout)).toEqual([]);
	});
});

describe("cronshed get", () => {
	test("AC-013: shows task details", async () => {
		await run("add", "my-task", "--schedule", "0 2 * * *", "--command", "echo hi");
		const { stdout, exitCode } = await run("get", "my-task");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("my-task");
		expect(stdout).toContain("0 2 * * *");
		expect(stdout).toContain("echo hi");
		expect(stdout).toContain("active");
	});

	test("AC-014: outputs JSON", async () => {
		await run("add", "my-task", "--schedule", "0 2 * * *", "--command", "echo hi");
		const { stdout, exitCode } = await run("get", "my-task", "--json");
		expect(exitCode).toBe(0);
		const parsed = JSON.parse(stdout);
		expect(parsed.name).toBe("my-task");
	});

	test("throws for non-existent task with exit code 1", async () => {
		const { stderr, exitCode } = await run("get", "ghost");
		expect(exitCode).toBe(1);
		expect(stderr).toContain('Task "ghost" not found');
	});

	test("AC-017: rejects missing name with exit code 2", async () => {
		const { stderr, exitCode } = await run("get");
		expect(exitCode).toBe(2);
		expect(stderr).toContain("Missing task name");
	});
});

describe("cronshed update", () => {
	test("AC-010: updates schedule", async () => {
		await run("add", "my-task", "--schedule", "0 2 * * *", "--command", "echo hi");
		const { stdout, exitCode } = await run("update", "my-task", "--schedule", "0 3 * * *");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Task my-task updated");

		const { stdout: details } = await run("get", "my-task");
		expect(details).toContain("0 3 * * *");
		expect(details).toContain("Updated:");
	});

	test("AC-012: rejects no changes with exit code 2", async () => {
		await run("add", "my-task", "--schedule", "0 2 * * *", "--command", "echo hi");
		const { stderr, exitCode } = await run("update", "my-task");
		expect(exitCode).toBe(2);
		expect(stderr).toContain("No changes specified");
	});

	test("AC-017: rejects missing name with exit code 2", async () => {
		const { stderr, exitCode } = await run("update");
		expect(exitCode).toBe(2);
		expect(stderr).toContain("Missing task name");
	});
});

describe("cronshed remove", () => {
	test("AC-008: removes a task", async () => {
		await run("add", "my-task", "--schedule", "0 2 * * *", "--command", "echo hi");
		const { stdout, exitCode } = await run("remove", "my-task");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Task my-task removed");

		const { stdout: listOut } = await run("list");
		expect(listOut).toContain("No tasks configured");
	});

	test("AC-009: rejects non-existent task with exit code 1", async () => {
		const { stderr, exitCode } = await run("remove", "ghost");
		expect(exitCode).toBe(1);
		expect(stderr).toContain('Task "ghost" not found');
	});

	test("AC-017: rejects missing name with exit code 2", async () => {
		const { stderr, exitCode } = await run("remove");
		expect(exitCode).toBe(2);
		expect(stderr).toContain("Missing task name");
	});
});

describe("error handling", () => {
	test("AC-018: corrupted manifest gives exit code 3", async () => {
		await Bun.write(join(tmpDir, "tasks.json"), "not json");
		const { stderr, exitCode } = await run("list");
		expect(exitCode).toBe(3);
		expect(stderr).toContain("corrupted");
	});

	test("unknown command gives exit code 2", async () => {
		const { stderr, exitCode } = await run("bogus");
		expect(exitCode).toBe(2);
		expect(stderr).toContain('Unknown command "bogus"');
	});
});

describe("command path resolution", () => {
	test("AC-021: add with relative script path resolves to absolute", async () => {
		const scriptPath = join(tmpDir, "test-script.sh");
		await Bun.write(scriptPath, "#!/bin/sh\necho hi");
		const { chmod } = await import("node:fs/promises");
		await chmod(scriptPath, 0o755);

		const { stdout, exitCode } = await run("add", "scripted", "--schedule", "0 0 * * *", "--command", scriptPath);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Task scripted created");
		expect(stdout).toContain(scriptPath);

		// Verify the absolute path is stored
		const { stdout: details } = await run("get", "scripted", "--json");
		const task = JSON.parse(details);
		expect(task.command).toBe(scriptPath);
	});

	test("AC-024: add with non-existent path gives exit code 2", async () => {
		const missing = join(tmpDir, "nonexistent.sh");
		const { stderr, exitCode } = await run("add", "broken", "--schedule", "0 0 * * *", "--command", missing);
		expect(exitCode).toBe(2);
		expect(stderr).toContain("File not found");
		expect(stderr).toContain("Resolved to:");
	});

	test("AC-025: add with non-executable file gives exit code 2", async () => {
		const scriptPath = join(tmpDir, "no-exec.sh");
		await Bun.write(scriptPath, "#!/bin/sh\necho hi");
		const { chmod } = await import("node:fs/promises");
		await chmod(scriptPath, 0o644);

		const { stderr, exitCode } = await run("add", "bad-exec", "--schedule", "0 0 * * *", "--command", scriptPath);
		expect(exitCode).toBe(2);
		expect(stderr).toContain("not executable");
		expect(stderr).toContain("chmod +x");
	});

	test("AC-026: add with inline command stores as-is", async () => {
		const { stdout, exitCode } = await run("add", "inline", "--schedule", "0 0 * * *", "--command", "echo hello world");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Task inline created");

		const { stdout: details } = await run("get", "inline", "--json");
		const task = JSON.parse(details);
		expect(task.command).toBe("echo hello world");
	});

	test("edge case 7: add with directory path gives exit code 2", async () => {
		const dir = join(tmpDir, "a-directory");
		const { mkdir: mkdirFs } = await import("node:fs/promises");
		await mkdirFs(dir);

		const { stderr, exitCode } = await run("add", "dir-cmd", "--schedule", "0 0 * * *", "--command", dir);
		expect(exitCode).toBe(2);
		expect(stderr).toContain("directory");
	});

	test("AC-029: update --command with relative path resolves", async () => {
		await run("add", "updatable", "--schedule", "0 0 * * *", "--command", "echo initial");

		const scriptPath = join(tmpDir, "updated-script.sh");
		await Bun.write(scriptPath, "#!/bin/sh\necho updated");
		const { chmod } = await import("node:fs/promises");
		await chmod(scriptPath, 0o755);

		const { stdout, exitCode } = await run("update", "updatable", "--command", scriptPath);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Task updatable updated");

		const { stdout: details } = await run("get", "updatable", "--json");
		const task = JSON.parse(details);
		expect(task.command).toBe(scriptPath);
	});

	test("AC-025: update --command with non-executable file gives exit code 2", async () => {
		await run("add", "updatable2", "--schedule", "0 0 * * *", "--command", "echo initial");

		const scriptPath = join(tmpDir, "no-exec-update.sh");
		await Bun.write(scriptPath, "#!/bin/sh\necho hi");
		const { chmod } = await import("node:fs/promises");
		await chmod(scriptPath, 0o644);

		const { stderr, exitCode } = await run("update", "updatable2", "--command", scriptPath);
		expect(exitCode).toBe(2);
		expect(stderr).toContain("not executable");
	});

	test("AC-029: update --schedule only does not trigger path resolution", async () => {
		await run("add", "sched-only", "--schedule", "0 0 * * *", "--command", "echo hi");
		const { stdout, exitCode } = await run("update", "sched-only", "--schedule", "0 4 * * *");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Task sched-only updated");

		const { stdout: details } = await run("get", "sched-only", "--json");
		const task = JSON.parse(details);
		expect(task.schedule).toBe("0 4 * * *");
		expect(task.command).toBe("echo hi");
	});
});
