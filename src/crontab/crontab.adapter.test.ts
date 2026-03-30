import { test, expect, describe } from "bun:test";
import { CrontabAdapter } from "./crontab.adapter";
import type { ShellExecutor } from "./crontab.adapter";
import { CrontabReadError, CrontabWriteError } from "./crontab.errors";
import type { CrontabEntry } from "./crontab.types";

function mockExecutor(responses: Record<string, { stdout: string; stderr: string; exitCode: number }>): ShellExecutor {
	return {
		async exec(cmd: string[]) {
			const key = cmd.join(" ");
			const response = responses[key];
			if (!response) {
				return { stdout: "", stderr: `Unknown command: ${key}`, exitCode: 127 };
			}
			return response;
		},
	};
}

describe("CrontabAdapter.read", () => {
	test("AC-030: parses crontab with cronshed entries and user lines", async () => {
		const crontab = [
			"30 3 * * * /usr/bin/custom-job",
			"",
			"# cronshed:backup-db",
			"0 2 * * * /usr/local/bin/backup.sh",
			"# cronshed:cleanup-logs",
			"0 4 * * 0 find /tmp -name '*.log' -delete",
		].join("\n") + "\n";

		const executor = mockExecutor({ "crontab -l": { stdout: crontab, stderr: "", exitCode: 0 } });
		const adapter = new CrontabAdapter(executor);
		const result = await adapter.read();

		expect(result.userLines).toEqual(["30 3 * * * /usr/bin/custom-job"]);
		expect(result.entries).toHaveLength(2);
		expect(result.entries[0]!.taskName).toBe("backup-db");
		expect(result.entries[0]!.schedule).toBe("0 2 * * *");
		expect(result.entries[0]!.command).toBe("/usr/local/bin/backup.sh");
		expect(result.entries[1]!.taskName).toBe("cleanup-logs");
	});

	test("AC-039: treats 'no crontab for user' as empty crontab", async () => {
		const executor = mockExecutor({
			"crontab -l": { stdout: "", stderr: "crontab: no crontab for julienm", exitCode: 1 },
		});
		const adapter = new CrontabAdapter(executor);
		const result = await adapter.read();

		expect(result.userLines).toEqual([]);
		expect(result.entries).toEqual([]);
	});

	test("AC-038: throws CrontabReadError on unexpected failure", async () => {
		const executor = mockExecutor({
			"crontab -l": { stdout: "", stderr: "permission denied", exitCode: 1 },
		});
		const adapter = new CrontabAdapter(executor);

		expect(adapter.read()).rejects.toBeInstanceOf(CrontabReadError);
	});

	test("AC-031: discards orphaned marker without following cron line", async () => {
		const crontab = [
			"# cronshed:broken-task",
			"# this is a comment, not a cron line",
			"# cronshed:valid-task",
			"0 2 * * * /usr/local/bin/backup.sh",
		].join("\n") + "\n";

		const executor = mockExecutor({ "crontab -l": { stdout: crontab, stderr: "", exitCode: 0 } });
		const adapter = new CrontabAdapter(executor);
		const result = await adapter.read();

		expect(result.entries).toHaveLength(1);
		expect(result.entries[0]!.taskName).toBe("valid-task");
		expect(result.userLines).toContain("# this is a comment, not a cron line");
	});

	test("AC-031: discards orphaned marker at EOF", async () => {
		const crontab = [
			"# cronshed:orphan-at-eof",
		].join("\n") + "\n";

		const executor = mockExecutor({ "crontab -l": { stdout: crontab, stderr: "", exitCode: 0 } });
		const adapter = new CrontabAdapter(executor);
		const result = await adapter.read();

		expect(result.entries).toEqual([]);
	});
});

describe("CrontabAdapter.build", () => {
	const adapter = new CrontabAdapter();

	test("AC-040: builds crontab with user lines, blank separator, and sorted entries", () => {
		const userLines = ["30 3 * * * /usr/bin/custom-job"];
		const entries: CrontabEntry[] = [
			{ taskName: "z-task", schedule: "0 1 * * *", command: "echo z" },
			{ taskName: "a-task", schedule: "0 2 * * *", command: "echo a" },
		];

		const result = adapter.build(userLines, entries);
		const lines = result.split("\n");

		expect(lines[0]).toBe("30 3 * * * /usr/bin/custom-job");
		expect(lines[1]).toBe("");
		expect(lines[2]).toBe("# cronshed:a-task");
		expect(lines[3]).toBe("0 2 * * * echo a");
		expect(lines[4]).toBe("# cronshed:z-task");
		expect(lines[5]).toBe("0 1 * * * echo z");
	});

	test("AC-040: no leading blank line when no user lines", () => {
		const entries: CrontabEntry[] = [
			{ taskName: "backup-db", schedule: "0 2 * * *", command: "/usr/local/bin/backup.sh" },
		];

		const result = adapter.build([], entries);
		const lines = result.split("\n");

		expect(lines[0]).toBe("# cronshed:backup-db");
		expect(lines[1]).toBe("0 2 * * * /usr/local/bin/backup.sh");
	});

	test("AC-033: preserves user lines verbatim", () => {
		const userLines = [
			"# My custom comment",
			"SHELL=/bin/bash",
			"30 3 * * * /usr/bin/custom-job",
		];

		const result = adapter.build(userLines, []);
		const lines = result.trimEnd().split("\n");

		expect(lines).toEqual(userLines);
	});

	test("builds empty crontab when no user lines and no entries", () => {
		const result = adapter.build([], []);
		expect(result).toBe("\n");
	});
});
