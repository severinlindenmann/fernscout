import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROUTE_FILE = /^(?:default|layout|page|route)\.(?:js|jsx|ts|tsx)$/;
const CONFIG_FILES = ["next.config.js", "next.config.mjs", "next.config.ts"];
const STAMP_VERSION = 1;

function filesBelow(root) {
  if (!fs.existsSync(root)) return [];

  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  };
  visit(root);
  return files.sort();
}

function digest(records) {
  const hash = crypto.createHash("sha256");
  for (const [name, content] of records) {
    hash.update(name);
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function nextVersion(root) {
  const packageFile = path.join(root, "node_modules", "next", "package.json");
  return JSON.parse(fs.readFileSync(packageFile, "utf8")).version;
}

export function routeInputsHash(root) {
  const records = [["next-version", nextVersion(root)]];

  for (const appDirectory of [path.join(root, "app"), path.join(root, "src", "app")]) {
    for (const file of filesBelow(appDirectory)) {
      if (ROUTE_FILE.test(path.basename(file))) {
        records.push(["route", path.relative(root, file).split(path.sep).join("/")]);
      }
    }
  }

  for (const name of CONFIG_FILES) {
    const file = path.join(root, name);
    if (fs.existsSync(file)) records.push([name, fs.readFileSync(file)]);
  }

  return digest(records);
}

export function generatedTypesHash(root, distDir = ".next") {
  const typesRoot = path.join(root, distDir, "types");
  const files = filesBelow(typesRoot);
  if (files.length === 0) return null;

  return digest(
    files.map((file) => [
      path.relative(typesRoot, file).split(path.sep).join("/"),
      fs.readFileSync(file),
    ]),
  );
}

export function stampPath(root, distDir = ".next") {
  return path.join(root, distDir, "fernscout-route-types.json");
}

export function writeRouteTypesStamp(root, distDir = ".next") {
  const typesHash = generatedTypesHash(root, distDir);
  if (!typesHash) throw new Error(`${distDir}/types is missing or empty after the build`);

  const stamp = {
    version: STAMP_VERSION,
    routeInputsHash: routeInputsHash(root),
    generatedTypesHash: typesHash,
  };
  fs.writeFileSync(stampPath(root, distDir), `${JSON.stringify(stamp, null, 2)}\n`);
  return stamp;
}

export function inspectRouteTypesStamp(root, distDir = ".next") {
  const file = stampPath(root, distDir);
  if (!fs.existsSync(file)) return { valid: false, reason: "no route-type build stamp exists" };

  let stamp;
  try {
    stamp = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { valid: false, reason: "the route-type build stamp is unreadable" };
  }

  if (stamp.version !== STAMP_VERSION) {
    return { valid: false, reason: "the route-type build stamp format changed" };
  }
  if (stamp.routeInputsHash !== routeInputsHash(root)) {
    return { valid: false, reason: "the route graph, Next version, or Next config changed" };
  }

  const typesHash = generatedTypesHash(root, distDir);
  if (!typesHash) return { valid: false, reason: `${distDir}/types is missing or empty` };
  if (stamp.generatedTypesHash !== typesHash) {
    return { valid: false, reason: "the generated route types changed after the build" };
  }

  return { valid: true, reason: "route inputs and generated types match the last successful build" };
}
