import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

export interface IgnoreRegion {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface RegressionOptions {
	threshold?: number;
	updateBaseline?: boolean;
}

export interface DesignOptions {
	threshold?: number;
	ignoreRegions?: IgnoreRegion[];
}

interface ScreenshotCapablePage {
	screenshot(options?: { fullPage?: boolean }): Promise<Uint8Array | ArrayBuffer>;
}

/**
 * Persist a baseline on first run and perform a byte-for-byte comparison afterwards.
 * This helper intentionally avoids extra dependencies so it stays buildable in this repo.
 * @param page Page-like object with a screenshot method
 * @param testName Stable test identifier
 * @param options Comparison options
 * @returns Resolves when the baseline is accepted or matches
 * @throws Error when the current screenshot differs from the saved baseline
 */
export async function compareRegression(
	page: ScreenshotCapablePage,
	testName: string,
	options: RegressionOptions = {},
): Promise<void> {
	const baselineDir = join(".specs", "features", getTestSuiteName(), "baselines");
	const baselinePath = join(baselineDir, `${testName}.png`);
	const actualBuffer = toBuffer(await page.screenshot({ fullPage: false }));

	if (!existsSync(baselinePath) || options.updateBaseline === true) {
		mkdirSync(baselineDir, { recursive: true });
		writeFileSync(baselinePath, actualBuffer);
		return;
	}

	const baselineBuffer = readFileSync(baselinePath);
	if (!actualBuffer.equals(baselineBuffer)) {
		throw new Error(`Visual regression detected for "${testName}". Update ${baselinePath} to accept the new baseline.`);
	}
}

/**
 * Compare a current screenshot with a stored mockup file.
 * The comparison is byte-for-byte and ignores the threshold fields.
 * @param page Page-like object with a screenshot method
 * @param mockupPath Path to a reference PNG
 * @param options Accepted for API compatibility
 * @returns Resolves when the files match or the mockup is missing
 * @throws Error when the screenshot differs from the reference file
 */
export async function compareDesign(
	page: ScreenshotCapablePage,
	mockupPath: string,
	options: DesignOptions = {},
): Promise<void> {
	void options;

	if (!existsSync(mockupPath)) {
		return;
	}

	const actualBuffer = toBuffer(await page.screenshot({ fullPage: false }));
	const expectedBuffer = readFileSync(mockupPath);

	if (!actualBuffer.equals(expectedBuffer)) {
		const testName = basename(mockupPath, ".png");
		throw new Error(`Visual design mismatch for "${testName}". Compare the current screenshot with ${mockupPath}.`);
	}
}

function toBuffer(value: Uint8Array | ArrayBuffer): Buffer {
	if (Buffer.isBuffer(value)) {
		return value;
	}

	if (value instanceof ArrayBuffer) {
		return Buffer.from(value);
	}

	return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function getTestSuiteName(): string {
	const feature = process.env.LIVESPEC_FEATURE;
	if (feature) {
		return feature.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
	}

	return "unknown";
}
