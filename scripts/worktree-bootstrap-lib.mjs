import crypto from "node:crypto";
import fs from "node:fs";

export function parseWorktreeList(text) {
  return text
    .trim()
    .split(/\n\n+/)
    .map((block) => Object.fromEntries(block.split("\n").map((line) => {
      const separator = line.indexOf(" ");
      return separator === -1 ? [line, true] : [line.slice(0, separator), line.slice(separator + 1)];
    })));
}

export function lockfileHash(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
