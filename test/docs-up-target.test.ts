// @scans components/DocsUpLink.tsx
import { expect, test } from "vitest";
import { docsUpTarget } from "@/components/DocsUpLink";

// B2855: a workbench goes up to the workbench list; everything else to the hub.
test("docs parents", () => {
  expect(docsUpTarget("/docs/branding/animation")).toBe("branding");
  expect(docsUpTarget("/de/docs/branding/identity")).toBe("branding");
  expect(docsUpTarget("/docs/branding")).toBe("hub");
  expect(docsUpTarget("/docs/hosting")).toBe("hub");
});
