import { test, expect, describe } from "bun:test";
import {
	parseUserLine,
	generateTaskName,
	resolveNameConflict,
	importCrontabEntries,
} from "./import.service";

// --- parseUserLine ---

describe("parseUserLine", () => {
	test("AC-002: parses valid cron line into schedule and command", () => {
		const result = parseUserLine("0 * * * * /usr/local/bin/backup.sh");
		expect(result).toEqual({
			schedule: "0 * * * *",
			command: "/usr/local/bin/backup.sh",
		});
	});

	test("AC-002: parses cron line with command arguments", () => {
		const result = parseUserLine("30 2 * * * /opt/scripts/rotate-logs.sh --days 7");
		expect(result).toEqual({
			schedule: "30 2 * * *",
			command: "/opt/scripts/rotate-logs.sh --days 7",
		});
	});

	test("AC-002: parses cron line with complex schedule", () => {
		const result = parseUserLine("*/15 9-17 * * 1-5 /usr/bin/check-status");
		expect(result).toEqual({
			schedule: "*/15 9-17 * * 1-5",
			command: "/usr/bin/check-status",
		});
	});

	test("AC-004: returns null for empty line", () => {
		expect(parseUserLine("")).toBeNull();
		expect(parseUserLine("   ")).toBeNull();
	});

	test("AC-004: returns null for comment line", () => {
		expect(parseUserLine("# This is a comment")).toBeNull();
		expect(parseUserLine("  # Indented comment")).toBeNull();
	});

	test("AC-004: returns null for environment variable assignment", () => {
		expect(parseUserLine("SHELL=/bin/bash")).toBeNull();
		expect(parseUserLine("MAILTO=admin@example.com")).toBeNull();
		expect(parseUserLine("PATH=/usr/local/bin:/usr/bin")).toBeNull();
	});

	test("AC-015: returns null for invalid cron expression", () => {
		// Line with text that looks like 6+ parts but is not a valid cron
		expect(parseUserLine("not a valid cron expression at all")).toBeNull();
	});

	test("returns null for line with fewer than 6 parts", () => {
		expect(parseUserLine("0 * * * *")).toBeNull();
		expect(parseUserLine("hello world")).toBeNull();
	});

	test("AC-002: preserves full command including arguments and pipes", () => {
		const result = parseUserLine("0 0 * * * cat /var/log/syslog | grep error | mail admin@example.com");
		expect(result).toEqual({
			schedule: "0 0 * * *",
			command: "cat /var/log/syslog | grep error | mail admin@example.com",
		});
	});
});

// --- generateTaskName ---

describe("generateTaskName", () => {
	test("AC-006: extracts name from absolute path", () => {
		expect(generateTaskName("/usr/local/bin/backup.sh")).toBe("backup");
	});

	test("AC-006: removes .sh extension", () => {
		expect(generateTaskName("/home/user/scripts/db-cleanup.sh")).toBe("db-cleanup");
	});

	test("AC-006: removes .py extension", () => {
		expect(generateTaskName("/home/user/scripts/db-cleanup.py")).toBe("db-cleanup");
	});

	test("AC-006: handles bare command", () => {
		expect(generateTaskName("curl https://example.com/ping")).toBe("curl");
	});

	test("AC-006: extracts from command with arguments", () => {
		expect(generateTaskName("/opt/scripts/rotate-logs.sh --days 7")).toBe("rotate-logs");
	});

	test("AC-006: normalizes underscores to hyphens", () => {
		expect(generateTaskName("/usr/bin/my_script_v2.sh")).toBe("my-script-v2");
	});

	test("AC-006: extracts first command from piped chain", () => {
		expect(generateTaskName("cat /var/log/syslog | grep error | mail admin@example.com")).toBe("cat");
	});

	test("AC-006: extracts first command from redirect", () => {
		expect(generateTaskName("/usr/bin/generate-report > /tmp/report.txt")).toBe("generate-report");
	});

	test("AC-006: extracts first command from && chain", () => {
		expect(generateTaskName("cd /opt/app && ./run.sh")).toBe("cd");
	});

	test("AC-006: falls back to 'imported-task' for empty/invalid names", () => {
		expect(generateTaskName("")).toBe("imported-task");
	});

	test("AC-007: prepends prefix when provided", () => {
		expect(generateTaskName("/usr/local/bin/backup.sh", "imported")).toBe("imported-backup");
	});

	test("AC-007: prepends prefix to bare command", () => {
		expect(generateTaskName("curl https://example.com", "cron")).toBe("cron-curl");
	});

	test("handles command with dots in name", () => {
		expect(generateTaskName("/usr/bin/my.tool.sh")).toBe("my-tool");
	});

	test("handles relative path", () => {
		expect(generateTaskName("./scripts/daily-check.sh")).toBe("daily-check");
	});

	test("handles tilde path", () => {
		expect(generateTaskName("~/bin/sync-data.sh")).toBe("sync-data");
	});
});

// --- resolveNameConflict ---

describe("resolveNameConflict", () => {
	test("AC-008: returns original name when no conflict", () => {
		const existing = new Set<string>();
		expect(resolveNameConflict("backup", existing)).toBe("backup");
	});

	test("AC-008: appends -2 on first conflict", () => {
		const existing = new Set(["backup"]);
		expect(resolveNameConflict("backup", existing)).toBe("backup-2");
	});

	test("AC-008: increments suffix for multiple conflicts", () => {
		const existing = new Set(["backup", "backup-2"]);
		expect(resolveNameConflict("backup", existing)).toBe("backup-3");
	});

	test("AC-008: handles many sequential conflicts", () => {
		const existing = new Set(["curl", "curl-2", "curl-3", "curl-4"]);
		expect(resolveNameConflict("curl", existing)).toBe("curl-5");
	});
});

// --- importCrontabEntries ---

describe("importCrontabEntries", () => {
	test("AC-001: imports valid cron entries", () => {
		const userLines = [
			"0 * * * * /usr/local/bin/backup.sh",
			"30 2 * * * /opt/scripts/cleanup.py",
		];
		const result = importCrontabEntries(userLines, new Set(), { dryRun: false });
		expect(result.imported).toHaveLength(2);
		expect(result.imported[0]!.name).toBe("backup");
		expect(result.imported[0]!.schedule).toBe("0 * * * *");
		expect(result.imported[0]!.command).toBe("/usr/local/bin/backup.sh");
		expect(result.imported[1]!.name).toBe("cleanup");
		expect(result.imported[1]!.schedule).toBe("30 2 * * *");
	});

	test("AC-014: returns empty imported for empty input", () => {
		const result = importCrontabEntries([], new Set(), { dryRun: false });
		expect(result.imported).toHaveLength(0);
		expect(result.skipped).toHaveLength(0);
	});

	test("AC-004: skips comments and empty lines", () => {
		const userLines = [
			"# Crontab header",
			"",
			"0 * * * * /usr/bin/task",
			"  ",
		];
		const result = importCrontabEntries(userLines, new Set(), { dryRun: false });
		expect(result.imported).toHaveLength(1);
		expect(result.imported[0]!.name).toBe("task");
	});

	test("AC-004: skips environment variable lines", () => {
		const userLines = [
			"SHELL=/bin/bash",
			"MAILTO=admin@example.com",
			"PATH=/usr/local/bin:/usr/bin",
			"0 * * * * /usr/bin/task",
		];
		const result = importCrontabEntries(userLines, new Set(), { dryRun: false });
		expect(result.imported).toHaveLength(1);
		expect(result.skipped).toHaveLength(3);
		expect(result.skipped[0]!.reason).toBe("Environment variable");
	});

	test("AC-008: resolves conflict with existing tasks", () => {
		const userLines = ["0 * * * * /usr/bin/backup.sh"];
		const existing = new Set(["backup"]);
		const result = importCrontabEntries(userLines, existing, { dryRun: false });
		expect(result.imported[0]!.name).toBe("backup-2");
	});

	test("AC-009: resolves conflicts within same import batch", () => {
		const userLines = [
			"0 * * * * /opt/a/backup.sh",
			"30 * * * * /opt/b/backup.sh",
		];
		const result = importCrontabEntries(userLines, new Set(), { dryRun: false });
		expect(result.imported[0]!.name).toBe("backup");
		expect(result.imported[1]!.name).toBe("backup-2");
	});

	test("AC-007: applies prefix to all generated names", () => {
		const userLines = [
			"0 * * * * /usr/bin/backup.sh",
			"30 * * * * curl https://example.com",
		];
		const result = importCrontabEntries(userLines, new Set(), { dryRun: false, prefix: "imported" });
		expect(result.imported[0]!.name).toBe("imported-backup");
		expect(result.imported[1]!.name).toBe("imported-curl");
	});

	test("carries dryRun flag through to result", () => {
		const result = importCrontabEntries([], new Set(), { dryRun: true });
		expect(result.dryRun).toBe(true);
	});

	test("AC-015: skips lines with invalid cron expressions", () => {
		const userLines = [
			"not a valid cron expression at all",
			"0 * * * * /usr/bin/valid-task",
		];
		const result = importCrontabEntries(userLines, new Set(), { dryRun: false });
		expect(result.imported).toHaveLength(1);
		expect(result.skipped.some((s) => s.reason === "Invalid cron format")).toBe(true);
	});

	test("preserves original line in imported entries", () => {
		const userLines = ["0 * * * * /usr/local/bin/backup.sh"];
		const result = importCrontabEntries(userLines, new Set(), { dryRun: false });
		expect(result.imported[0]!.originalLine).toBe("0 * * * * /usr/local/bin/backup.sh");
	});

	test("mixed content: imports only valid cron entries", () => {
		const userLines = [
			"# Header comment",
			"SHELL=/bin/bash",
			"",
			"0 * * * * /usr/bin/hourly-task",
			"invalid line here",
			"30 2 * * * /opt/daily-backup.sh",
			"# Another comment",
		];
		const result = importCrontabEntries(userLines, new Set(), { dryRun: false });
		expect(result.imported).toHaveLength(2);
		expect(result.imported[0]!.name).toBe("hourly-task");
		expect(result.imported[1]!.name).toBe("daily-backup");
	});
});
