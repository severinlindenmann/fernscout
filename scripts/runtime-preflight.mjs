import fs from "node:fs";
import path from "node:path";

export function requiredNodeVersion(root) {
  return fs.readFileSync(path.join(root, ".nvmrc"), "utf8").trim().replace(/^v/, "");
}

export function repositoryNodeError(root, actual = process.versions.node) {
  const required = requiredNodeVersion(root);
  if (actual === required) return null;
  return (
    `Node ${actual} is active, but Fernscout requires Node ${required} from .nvmrc.\n` +
    "Run `nvm use` (or otherwise put that Node version first in PATH), then retry."
  );
}

export function assertRepositoryNode(root) {
  const error = repositoryNodeError(root);
  if (!error) return;
  console.error(error);
  process.exit(1);
}
