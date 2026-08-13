// @spec FR-095: Schedule interval calculation — .specs/features/015-wrapper-protections/spec.md#fr-095

import { CronExpressionParser } from "cron-parser";

/** Number of consecutive occurrences to sample for minimum gap calculation. */
const SAMPLE_COUNT = 10;

/**
 * Parse a cron expression and return the minimum interval between
 * consecutive executions in seconds.
 * Samples N consecutive occurrences and finds the smallest gap.
 * @param schedule Valid cron expression string
 * @returns Minimum interval in seconds, or null if it cannot be determined
 */
export function scheduleToIntervalSeconds(schedule: string): number | null {
	try {
		const interval = CronExpressionParser.parse(schedule);
		const times: number[] = [];

		for (let i = 0; i < SAMPLE_COUNT; i++) {
			times.push(interval.next().toDate().getTime());
		}

		let minGap = Infinity;
		for (let i = 1; i < times.length; i++) {
			const gap = (times[i]! - times[i - 1]!) / 1000;
			if (gap < minGap) {
				minGap = gap;
			}
		}

		return minGap === Infinity ? null : minGap;
	} catch {
		return null;
	}
}
