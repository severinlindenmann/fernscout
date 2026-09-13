#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { writeRouteTypesStamp } from "./route-types-stamp.mjs";

const root = process.cwd();
const distDir = process.env.NEXT_DIST_DIR || ".next";
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextBin, "build", ...process.argv.slice(2)], {
  stdio: "inherit",
});

child.on("close", (status, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  if (status !== 0) {
    process.exitCode = status ?? 1;
    return;
  }

  try {
    writeRouteTypesStamp(root, distDir);
    console.log(`\nStamped ${distDir}/types for safe verify --quick reuse.`);
  } catch (error) {
    console.error(`\nBuild succeeded, but its route types could not be stamped: ${error.message}`);
    process.exitCode = 1;
  }
});
