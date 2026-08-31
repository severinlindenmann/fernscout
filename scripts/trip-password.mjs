// Hashes a password for a trip, for pasting into content/trips/<id>/trip.md.
//
//   npm run trip:password -- "the password"
//
// Then set, in that trip's frontmatter:
//   visibility: password
//   passwordHash: "<the line this prints>"
//
// The format must stay identical to lib/access.ts. test/access.test.ts checks
// that a hash produced here verifies there, so the two cannot drift apart.
import crypto from "node:crypto";

const N = 1 << 15;
const r = 8;
const p = 1;
const KEY_LEN = 32;

const password = process.argv[2];
if (!password) {
  console.error('Usage: npm run trip:password -- "the password"');
  process.exit(1);
}
if (password.length < 6) {
  console.error("Use at least 6 characters — this is the only thing guarding the trip.");
  process.exit(1);
}

const salt = crypto.randomBytes(16);
const key = crypto.scryptSync(password.normalize("NFKC"), salt, KEY_LEN, {
  N,
  r,
  p,
  maxmem: 128 * N * r * 2,
});

console.log(
  `scrypt$${N}$${r}$${p}$${salt.toString("base64url")}$${key.toString("base64url")}`,
);
