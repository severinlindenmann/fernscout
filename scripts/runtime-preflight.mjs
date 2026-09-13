import fs from "node:fs";
import path from "node:path";

/** The version `.nvmrc` pins, or `null` where there is no such file.
 *
 * Null rather than a throw: `.nvmrc` is absent in a scratch directory, in a
 * consumer's checkout, and anywhere this is called before the tree is known
 * to be a Fernscout one. A missing pin means "nothing to enforce", and a raw
 * ENOENT stack here buries whatever the caller was actually about to say —
 * which is exactly what it did to the unattended-run refusal. */
export function requiredNodeVersion(root) {
  try {
    return fs.readFileSync(path.join(root, ".nvmrc"), "utf8").trim().replace(/^v/, "");
  } catch {
    return null;
  }
}

export function repositoryNodeError(root, actual = process.versions.node) {
  const required = requiredNodeVersion(root);
  if (required === null || actual === required) return null;
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
