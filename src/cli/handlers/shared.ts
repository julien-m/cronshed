// Shared utilities used across multiple handler modules.
// @spec FR-029, FR-030, FR-031, FR-032, FR-033: Auto-sync after mutations — .specs/features/004-auto-sync/spec.md#fr-029

import { TaskRepository } from "../../task/task.repository";
import { SyncService } from "../../crontab/sync.service";
import { CrontabAdapter } from "../../crontab/crontab.adapter";
import { WrapperService } from "../../wrapper/wrapper.service";
import { getDataDir } from "../../app/config";
import { formatWarning, formatSyncConfirmation } from "../formatters/base.formatter";

/**
 * Trigger a non-fatal crontab sync after a manifest mutation.
 * If sync fails the manifest change is preserved and a warning is printed.
 * @spec FR-029, FR-044: Auto-sync passes WrapperService — .specs/features/004-auto-sync/spec.md#fr-029
 */
export async function autoSync(repo: TaskRepository): Promise<void> {
	try {
		const adapter = new CrontabAdapter();
		const wrapperService = new WrapperService(getDataDir());
		const syncService = new SyncService(repo, adapter, wrapperService);
		await syncService.sync();
		console.log(formatSyncConfirmation());
	} catch (error) {
		// Non-fatal sync errors: manifest mutation succeeded but crontab sync failed
		// Log the actual error details for debugging without exposing implementation details
		const errorDetail = error instanceof Error ? error.message : String(error);
		const hint = `Could not sync to crontab: ${errorDetail}. Run 'cronshed sync' to retry`;
		console.error(formatWarning("Sync skipped", hint));
	}
}
