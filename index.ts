#!/usr/bin/env bun
import { runCli } from "./src/cli/cli.handler";

await runCli(process.argv);
