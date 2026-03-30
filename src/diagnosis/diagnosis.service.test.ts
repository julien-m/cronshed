import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DiagnosisService } from "./diagnosis.service";
import { TaskRepository } from "../task/task.repository";
import { CrontabAdapter } from "../crontab/crontab.adapter";
import type { ShellExecutor } from "../crontab/crontab.adapter";
import { WrapperService } from "../wrapper/wrapper.service";
import type { Task } from "../task/task.types";
import { DIAGNOSIS_CHECKS } from "./diagnosis.types";
import { TaskService } from "../task/task.service";

let tmpDir: string;
let repo: TaskRepository;
let adapter: CrontabAdapter;
let wrapperService: WrapperService;
let service: DiagnosisService;
let taskService: TaskService;
let mockCrontabContent: string;

/** Mock executor that returns configurable crontab content. */
function createMockExecutor(getCrontab: () => string): ShellExecutor {
	return {
		async exec(cmd: string[]) {
			if (cmd[0] === "crontab" && cmd[1] === "-l") {
				const content = getCrontab();
				if (content === "__NO_CRONTAB__") {
					return { stdout: "", stderr: "crontab: no crontab for user", exitCode: 1 };
				}
				return { stdout: content, stderr: "", exitCode: 0 };
			}
			if (cmd[0] === "crontab" && cmd[1] === "-") {
				return { stdout: "", stderr: "", exitCode: 0 };
			}
			return { stdout: "", stderr: "unknown command", exitCode: 1 };
		},
	};
}

beforeEach(async () => {
	tmpDir = await mkdtemp(join(tmpdir(), "cronshed-diag-test-"));
	mockCrontabContent = "__NO_CRONTAB__";

	repo = new TaskRepository(join(tmpDir, "tasks.json"));
	adapter = new CrontabAdapter(createMockExecutor(() => mockCrontabContent));
	wrapperService = new WrapperService(tmpDir);
	service = new DiagnosisService(repo, adapter, wrapperService, tmpDir);
	taskService = new TaskService(repo);
});

/**
 * Helper to create a task directly in the manifest.
 */
async function createTask(overrides: Partial<Task> & { name: string }): Promise<Task> {
	const defaults: Task = {
		id: crypto.randomUUID(),
		name: overrides.name,
		schedule: "0 2 * * *",
		command: "echo hello",
		status: "active",
		notify: false,
		createdAt: new Date().toISOString(),
	};
	const task = { ...defaults, ...overrides };

	const manifest = await repo.load();
	manifest.tasks.push(task);
	await repo.save(manifest);
	return task;
}

// --- diagnoseAll ---

describe("DiagnosisService.diagnoseAll", () => {
	test("AC-015: returns empty array when no tasks exist", async () => {
		const results = await service.diagnoseAll();
		expect(results).toEqual([]);
	});

	test("AC-001: diagnoses all tasks in the manifest", async () => {
		await createTask({ name: "task-a", command: "echo a" });
		await createTask({ name: "task-b", command: "echo b" });

		const results = await service.diagnoseAll();
		expect(results).toHaveLength(2);
		expect(results[0]!.taskName).toBe("task-a");
		expect(results[1]!.taskName).toBe("task-b");
	});

	test("returns ok for healthy inline-command tasks with wrappers and crontab", async () => {
		const task = await createTask({ name: "healthy-task", command: "echo ok" });
		await wrapperService.generate(task);

		// Set up crontab with the entry
		const wrapperPath = wrapperService.getWrapperPath("healthy-task");
		mockCrontabContent = `# cronshed:healthy-task\n0 2 * * * ${wrapperPath}\n`;

		const results = await service.diagnoseAll();
		expect(results).toHaveLength(1);
		expect(results[0]!.status).toBe("ok");
		expect(results[0]!.issues).toHaveLength(0);
	});
});

// --- Cron expression check ---

describe("checkCronExpression", () => {
	test("AC-004: detects invalid cron expression", async () => {
		const task = await createTask({ name: "bad-cron", schedule: "not a cron" });
		const result = await service.diagnose(task);

		const issue = result.issues.find((i) => i.check === DIAGNOSIS_CHECKS.CRON_EXPRESSION);
		expect(issue).toBeDefined();
		expect(issue!.severity).toBe("error");
		expect(issue!.message).toContain("Invalid cron expression");
		expect(issue!.message).toContain("not a cron");
	});

	test("valid cron expression passes", async () => {
		const task = await createTask({ name: "good-cron", schedule: "0 2 * * *" });
		const result = await service.diagnose(task);

		const issue = result.issues.find((i) => i.check === DIAGNOSIS_CHECKS.CRON_EXPRESSION);
		expect(issue).toBeUndefined();
	});

	test("detects empty cron expression", async () => {
		const task = await createTask({ name: "empty-cron", schedule: "   " });
		const result = await service.diagnose(task);

		const issue = result.issues.find((i) => i.check === DIAGNOSIS_CHECKS.CRON_EXPRESSION);
		expect(issue).toBeDefined();
		expect(issue!.severity).toBe("error");
	});
});

// --- Command file checks ---

describe("checkCommandFile", () => {
	test("AC-008: skips check for inline commands", async () => {
		const task = await createTask({ name: "inline-cmd", command: "echo hello" });
		const result = await service.diagnose(task);

		const fileIssues = result.issues.filter((i) =>
			i.check === DIAGNOSIS_CHECKS.COMMAND_FILE_NOT_FOUND ||
			i.check === DIAGNOSIS_CHECKS.COMMAND_FILE_NOT_EXECUTABLE ||
			i.check === DIAGNOSIS_CHECKS.COMMAND_FILE_IS_DIRECTORY
		);
		expect(fileIssues).toHaveLength(0);
	});

	test("AC-005: detects missing command file", async () => {
		const missingPath = join(tmpDir, "nonexistent.sh");
		const task = await createTask({ name: "missing-file", command: missingPath });
		const result = await service.diagnose(task);

		const issue = result.issues.find((i) => i.check === DIAGNOSIS_CHECKS.COMMAND_FILE_NOT_FOUND);
		expect(issue).toBeDefined();
		expect(issue!.severity).toBe("error");
		expect(issue!.message).toContain("Command file not found");
	});

	test("AC-006: detects non-executable command file", async () => {
		const scriptPath = join(tmpDir, "no-exec.sh");
		await writeFile(scriptPath, "#!/bin/bash\necho hi\n");
		await chmod(scriptPath, 0o644);

		const task = await createTask({ name: "no-exec", command: scriptPath });
		const result = await service.diagnose(task);

		const issue = result.issues.find((i) => i.check === DIAGNOSIS_CHECKS.COMMAND_FILE_NOT_EXECUTABLE);
		expect(issue).toBeDefined();
		expect(issue!.severity).toBe("error");
		expect(issue!.message).toContain("not executable");
		expect(issue!.hint).toContain("chmod +x");
	});

	test("AC-007: detects command path that is a directory", async () => {
		const dirPath = join(tmpDir, "somedir");
		await mkdir(dirPath, { recursive: true });

		const task = await createTask({ name: "dir-cmd", command: dirPath });
		const result = await service.diagnose(task);

		const issue = result.issues.find((i) => i.check === DIAGNOSIS_CHECKS.COMMAND_FILE_IS_DIRECTORY);
		expect(issue).toBeDefined();
		expect(issue!.severity).toBe("error");
		expect(issue!.message).toContain("is a directory");
	});

	test("valid executable file passes", async () => {
		const scriptPath = join(tmpDir, "good.sh");
		await writeFile(scriptPath, "#!/bin/bash\necho hi\n");
		await chmod(scriptPath, 0o755);

		const task = await createTask({ name: "good-file", command: scriptPath });
		const result = await service.diagnose(task);

		const fileIssues = result.issues.filter((i) =>
			i.check === DIAGNOSIS_CHECKS.COMMAND_FILE_NOT_FOUND ||
			i.check === DIAGNOSIS_CHECKS.COMMAND_FILE_NOT_EXECUTABLE ||
			i.check === DIAGNOSIS_CHECKS.COMMAND_FILE_IS_DIRECTORY
		);
		expect(fileIssues).toHaveLength(0);
	});

	test("command with arguments checks first token only", async () => {
		const scriptPath = join(tmpDir, "script-with-args.sh");
		await writeFile(scriptPath, "#!/bin/bash\necho $1\n");
		await chmod(scriptPath, 0o755);

		const task = await createTask({ name: "with-args", command: `${scriptPath} --flag value` });
		const result = await service.diagnose(task);

		const fileIssues = result.issues.filter((i) =>
			i.check === DIAGNOSIS_CHECKS.COMMAND_FILE_NOT_FOUND ||
			i.check === DIAGNOSIS_CHECKS.COMMAND_FILE_NOT_EXECUTABLE ||
			i.check === DIAGNOSIS_CHECKS.COMMAND_FILE_IS_DIRECTORY
		);
		expect(fileIssues).toHaveLength(0);
	});
});

// --- Wrapper checks ---

describe("checkWrapper", () => {
	test("AC-009: detects missing wrapper script", async () => {
		const task = await createTask({ name: "no-wrapper", command: "echo hi" });
		// Do not generate wrapper

		const result = await service.diagnose(task);

		const issue = result.issues.find((i) => i.check === DIAGNOSIS_CHECKS.WRAPPER_MISSING);
		expect(issue).toBeDefined();
		expect(issue!.severity).toBe("warning");
		expect(issue!.hint).toContain("cronshed sync");
	});

	test("AC-010: detects stale wrapper script", async () => {
		const task = await createTask({ name: "stale-wrapper", command: "echo original" });
		await wrapperService.generate(task);

		// Now update the task command without regenerating wrapper
		task.command = "echo updated";
		const manifest = await repo.load();
		const idx = manifest.tasks.findIndex((t) => t.name === task.name);
		manifest.tasks[idx] = task;
		await repo.save(manifest);

		const result = await service.diagnose(task);

		const issue = result.issues.find((i) => i.check === DIAGNOSIS_CHECKS.WRAPPER_STALE);
		expect(issue).toBeDefined();
		expect(issue!.severity).toBe("warning");
		expect(issue!.hint).toContain("cronshed sync");
	});

	test("up-to-date wrapper passes", async () => {
		const task = await createTask({ name: "fresh-wrapper", command: "echo hi" });
		await wrapperService.generate(task);

		const result = await service.diagnose(task);

		const wrapperIssues = result.issues.filter((i) =>
			i.check === DIAGNOSIS_CHECKS.WRAPPER_MISSING ||
			i.check === DIAGNOSIS_CHECKS.WRAPPER_STALE
		);
		expect(wrapperIssues).toHaveLength(0);
	});
});

// --- Crontab entry checks ---

describe("checkCrontabEntry", () => {
	test("AC-011: detects missing crontab entry for active task", async () => {
		const task = await createTask({ name: "no-crontab", command: "echo hi" });
		await wrapperService.generate(task);
		mockCrontabContent = ""; // Empty crontab (no entries)

		const result = await service.diagnose(task);

		const issue = result.issues.find((i) => i.check === DIAGNOSIS_CHECKS.CRONTAB_ENTRY_MISSING);
		expect(issue).toBeDefined();
		expect(issue!.severity).toBe("warning");
		expect(issue!.hint).toContain("cronshed sync");
	});

	test("AC-012: does not report missing crontab entry for paused task", async () => {
		const task = await createTask({ name: "paused-task", command: "echo hi", status: "paused" });
		await wrapperService.generate(task);
		mockCrontabContent = ""; // No crontab entries

		const result = await service.diagnose(task);

		const issue = result.issues.find((i) => i.check === DIAGNOSIS_CHECKS.CRONTAB_ENTRY_MISSING);
		expect(issue).toBeUndefined();
	});

	test("active task with crontab entry passes", async () => {
		const task = await createTask({ name: "in-crontab", command: "echo hi" });
		await wrapperService.generate(task);
		mockCrontabContent = `# cronshed:in-crontab\n0 2 * * * /some/path\n`;

		const result = await service.diagnose(task);

		const issue = result.issues.find((i) => i.check === DIAGNOSIS_CHECKS.CRONTAB_ENTRY_MISSING);
		expect(issue).toBeUndefined();
	});

	test("gracefully handles crontab read failure", async () => {
		// Create an adapter that always fails
		const failingExecutor: ShellExecutor = {
			async exec() {
				return { stdout: "", stderr: "permission denied", exitCode: 1 };
			},
		};
		const failingAdapter = new CrontabAdapter(failingExecutor);
		const failService = new DiagnosisService(repo, failingAdapter, wrapperService, tmpDir);

		const task = await createTask({ name: "crontab-fail", command: "echo hi" });
		await wrapperService.generate(task);

		const result = await failService.diagnose(task);

		// Should not have a crontab entry issue (check skipped gracefully)
		const issue = result.issues.find((i) => i.check === DIAGNOSIS_CHECKS.CRONTAB_ENTRY_MISSING);
		expect(issue).toBeUndefined();
	});
});

// --- Result structure ---

describe("result structure", () => {
	test("AC-013: status is 'ok' when no issues", async () => {
		const task = await createTask({ name: "healthy", command: "echo hi" });
		await wrapperService.generate(task);
		const wrapperPath = wrapperService.getWrapperPath("healthy");
		mockCrontabContent = `# cronshed:healthy\n0 2 * * * ${wrapperPath}\n`;

		const result = await service.diagnose(task);
		expect(result.status).toBe("ok");
		expect(result.issues).toHaveLength(0);
	});

	test("AC-013: status is 'issues' when problems found", async () => {
		const task = await createTask({ name: "broken", schedule: "invalid cron" });

		const result = await service.diagnose(task);
		expect(result.status).toBe("issues");
		expect(result.issues.length).toBeGreaterThan(0);
	});

	test("taskName matches the diagnosed task", async () => {
		const task = await createTask({ name: "my-task", command: "echo hi" });
		const result = await service.diagnose(task);
		expect(result.taskName).toBe("my-task");
	});
});
