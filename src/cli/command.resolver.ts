// @spec FR-011: Path detection, FR-012: Path resolution, FR-013: Existence check, FR-014: Permission check, FR-015: Store resolved — .specs/features/002-command-path-resolution/spec.md#fr-011

import { resolve } from "node:path";
import { homedir } from "node:os";
import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import {
	CommandFileNotFoundError,
	CommandFileNotExecutableError,
	CommandPathIsDirectoryError,
} from "./command.errors";

/** Result of resolving a command string. */
export interface CommandResolution {
	original: string;
	resolved: string;
	isFilePath: boolean;
}

/**
 * Check if the first token of a command looks like a file path.
 * Detects prefixes: `./`, `../`, `~/`, or `/`.
 * @param command The raw command string
 * @returns true if the first token starts with a path prefix
 */
export function isFilePath(command: string): boolean {
	const firstToken = command.split(" ")[0] ?? "";
	return (
		firstToken.startsWith("./") ||
		firstToken.startsWith("../") ||
		firstToken.startsWith("~/") ||
		firstToken.startsWith("/")
	);
}

/**
 * Resolve a command string: detect file paths, resolve to absolute, validate existence and permissions.
 * Inline commands (no path prefix) are returned as-is without validation.
 * @param command The raw command string from --command flag
 * @returns CommandResolution with the resolved command and metadata
 * @throws CommandFileNotFoundError if the file path does not exist
 * @throws CommandFileNotExecutableError if the file exists but is not executable
 * @throws CommandPathIsDirectoryError if the path resolves to a directory
 */
export async function resolveCommand(command: string): Promise<CommandResolution> {
	if (!isFilePath(command)) {
		return { original: command, resolved: command, isFilePath: false };
	}

	// Resolve path and split command from arguments.
	// For ./ ../ ~/ prefixes: try full string as path first (handles paths with spaces),
	// then fall back to first-token splitting.
	// For / prefix: split on first space (could be inline like "/usr/bin/env python3").
	const { pathToken, restArgs } = await splitCommandPath(command);

	// Resolve the path to absolute
	let resolvedPath: string;
	if (pathToken.startsWith("~/")) {
		resolvedPath = resolve(homedir(), pathToken.slice(2));
	} else {
		resolvedPath = resolve(pathToken);
	}

	// For absolute paths with arguments, check if first token exists
	// If not found, treat as inline (e.g. `/nonexistent/tool arg`)
	if (pathToken.startsWith("/") && restArgs) {
		const exists = await fileExists(resolvedPath);
		if (!exists) {
			return { original: command, resolved: command, isFilePath: false };
		}
	}

	// Check existence (handles both files and directories)
	let fileStat: Awaited<ReturnType<typeof stat>>;
	try {
		fileStat = await stat(resolvedPath);
	} catch {
		throw new CommandFileNotFoundError(pathToken, resolvedPath);
	}

	// Check it is a regular file (not a directory)
	if (fileStat.isDirectory()) {
		throw new CommandPathIsDirectoryError(pathToken, resolvedPath);
	}

	// Check executable permission
	try {
		await access(resolvedPath, constants.X_OK);
	} catch {
		throw new CommandFileNotExecutableError(pathToken, resolvedPath);
	}

	const resolved = restArgs ? `${resolvedPath} ${restArgs}` : resolvedPath;
	return { original: command, resolved, isFilePath: true };
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

async function splitCommandPath(command: string): Promise<{ pathToken: string; restArgs: string }> {
	const spaceIndex = command.indexOf(" ");

	// No spaces → whole string is the path
	if (spaceIndex === -1) {
		return { pathToken: command, restArgs: "" };
	}

	// Try full string as a path first (handles paths with spaces)
	let fullPath: string;
	if (command.startsWith("~/")) {
		fullPath = resolve(homedir(), command.slice(2));
	} else {
		fullPath = resolve(command);
	}
	if (await fileExists(fullPath)) {
		return { pathToken: command, restArgs: "" };
	}

	// Fall back to split on first space
	return {
		pathToken: command.slice(0, spaceIndex),
		restArgs: command.slice(spaceIndex + 1),
	};
}
