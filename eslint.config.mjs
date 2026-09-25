import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    // And any alternative build output — `NEXT_DIST_DIR=.next-preview` exists
    // so a build can be checked without stopping a running server, and the
    // default list only knows the name `.next`. Linting a build output reports
    // twelve thousand problems in generated code.
    ".next-*/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Agent worktrees are full checkouts living inside the repo; linting them
    // reports every problem several times over.
    ".claude/**",
  ]),
]);

export default eslintConfig;
