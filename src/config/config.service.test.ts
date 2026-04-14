import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigRepository } from "./config.repository";
import { ConfigService, InvalidConfigKeyError, InvalidConfigValueError } from "./config.service";

describe("ConfigService", () => {
	let tmpDir: string;
	let repo: ConfigRepository;
	let service: ConfigService;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "cronshed-config-test-"));
		repo = new ConfigRepository(join(tmpDir, "config.json"));
		service = new ConfigService(repo);
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	describe("set", () => {
		test("AC-084: sets valid ratio 0.8", async () => {
			await service.set("default-timeout-ratio", "0.8");
			const value = await service.get("default-timeout-ratio");
			expect(value).toBe("0.8");
		});

		test("AC-084: sets valid ratio 1.0", async () => {
			await service.set("default-timeout-ratio", "1");
			const value = await service.get("default-timeout-ratio");
			expect(value).toBe("1");
		});

		test("AC-085: rejects ratio > 1", async () => {
			expect(service.set("default-timeout-ratio", "1.5")).rejects.toThrow(InvalidConfigValueError);
		});

		test("AC-085: rejects negative ratio", async () => {
			expect(service.set("default-timeout-ratio", "-0.3")).rejects.toThrow(InvalidConfigValueError);
		});

		test("AC-085: rejects zero ratio", async () => {
			expect(service.set("default-timeout-ratio", "0")).rejects.toThrow(InvalidConfigValueError);
		});

		test("rejects non-numeric value", async () => {
			expect(service.set("default-timeout-ratio", "abc")).rejects.toThrow(InvalidConfigValueError);
		});

		test("rejects unknown key", async () => {
			expect(service.set("unknown-key", "0.5")).rejects.toThrow(InvalidConfigKeyError);
		});
	});

	describe("get", () => {
		test("AC-088: returns value when set", async () => {
			await service.set("default-timeout-ratio", "0.8");
			const value = await service.get("default-timeout-ratio");
			expect(value).toBe("0.8");
		});

		test("AC-088: returns undefined when not set", async () => {
			const value = await service.get("default-timeout-ratio");
			expect(value).toBeUndefined();
		});

		test("rejects unknown key", async () => {
			expect(service.get("unknown-key")).rejects.toThrow(InvalidConfigKeyError);
		});
	});
});

describe("ConfigRepository", () => {
	let tmpDir: string;
	let repo: ConfigRepository;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "cronshed-config-repo-test-"));
		repo = new ConfigRepository(join(tmpDir, "config.json"));
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	test("load returns empty config when file is missing", async () => {
		const config = await repo.load();
		expect(config).toEqual({});
	});

	test("save and load roundtrip", async () => {
		await repo.save({ defaultTimeoutRatio: 0.8 });
		const config = await repo.load();
		expect(config.defaultTimeoutRatio).toBe(0.8);
	});

	test("creates parent directory on save", async () => {
		const nestedRepo = new ConfigRepository(join(tmpDir, "nested", "dir", "config.json"));
		await nestedRepo.save({ defaultTimeoutRatio: 0.5 });
		const config = await nestedRepo.load();
		expect(config.defaultTimeoutRatio).toBe(0.5);
	});
});
