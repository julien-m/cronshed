// @spec FR-002: Task entity definition — .specs/features/001-task-manifest/spec.md#fr-002

// @spec FR-047: Task entity with notify field — .specs/features/008-failure-notifications/spec.md#fr-047
// @spec FR-055: Status expanded to active|paused — .specs/features/009-task-pause-resume/spec.md#fr-055
export interface Task {
	id: string;
	name: string;
	schedule: string;
	command: string;
	status: TaskStatus;
	notify: boolean;
	createdAt: string;
	updatedAt?: string;
}

export interface TaskManifest {
	version: 1;
	tasks: Task[];
}

export interface CreateTaskInput {
	name: string;
	schedule: string;
	command: string;
	notify?: boolean;
}

export interface UpdateTaskInput {
	schedule?: string;
	command?: string;
	notify?: boolean;
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

export const MANIFEST_VERSION = 1 as const;
