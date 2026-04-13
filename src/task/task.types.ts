// @spec FR-002: Task entity definition — .specs/features/001-task-manifest/spec.md#fr-002

// @spec FR-047: Task entity with notify field, FR-055: JSON includes notify — .specs/features/008-failure-notifications/spec.md#fr-047
// @spec FR-055: Status expanded to active|paused — .specs/features/009-task-pause-resume/spec.md#fr-055
// @spec FR-001: Tags field on Task — .specs/features/013-task-groups-tags/spec.md#fr-001
// @spec FR-088: Protection fields on Task — .specs/features/015-wrapper-protections/spec.md#fr-088
export interface Task {
	id: string;
	name: string;
	schedule: string;
	command: string;
	status: TaskStatus;
	notify: boolean;
	tags: string[];
	allowParallel?: boolean;
	timeout?: string;
	createdAt: string;
	updatedAt?: string;
}

export interface TaskManifest {
	version: 1;
	tasks: Task[];
}

// @spec FR-002: CreateTaskInput with tags — .specs/features/013-task-groups-tags/spec.md#fr-002
// @spec FR-088: Protection fields on CreateTaskInput — .specs/features/015-wrapper-protections/spec.md#fr-088
export interface CreateTaskInput {
	name: string;
	schedule: string;
	command: string;
	notify?: boolean;
	tags?: string[];
	allowParallel?: boolean;
	timeout?: string;
}

// @spec FR-003: UpdateTaskInput with tags/untags — .specs/features/013-task-groups-tags/spec.md#fr-003
// @spec FR-088: Protection fields on UpdateTaskInput — .specs/features/015-wrapper-protections/spec.md#fr-088
export interface UpdateTaskInput {
	schedule?: string;
	command?: string;
	notify?: boolean;
	tags?: string[];
	untags?: string[];
	allowParallel?: boolean;
	timeout?: string;
}

// @spec FR-055: TASK_STATUS includes paused — .specs/features/009-task-pause-resume/spec.md#fr-055
export const TASK_STATUS = {
	ACTIVE: "active",
	PAUSED: "paused",
} as const;

export type TaskStatus = (typeof TASK_STATUS)[keyof typeof TASK_STATUS];

// @spec FR-006: EnrichedTask type — .specs/features/006-task-listing-status/spec.md#fr-006
export interface EnrichedTask extends Task {
	lastRun: string | null;
	lastExitCode: number | null;
	nextRun: string;
}

export const TASK_NAME_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// @spec FR-007: Tag validation uses same regex as task names — .specs/features/013-task-groups-tags/spec.md#fr-007
export const TAG_REGEX = TASK_NAME_REGEX;

/**
 * Deduplicate and sort an array of tags.
 * @param tags Array of tag strings
 * @returns Sorted array of unique tags
 */
export function normalizeTags(tags: string[]): string[] {
	return [...new Set(tags)].sort();
}

export const MANIFEST_VERSION = 1 as const;
