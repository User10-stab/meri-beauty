import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const launcher = readFileSync(`${root}scripts/dev-with-stripe-webhooks.mjs`, "utf8");

describe("local Stripe development launcher", () => {
  test("starts Next through Node instead of a platform-specific .bin shim", () => {
    expect(launcher).toContain('"node_modules", "next", "dist", "bin", "next"');
    expect(launcher).toContain('spawn(process.execPath, [nextCli, "dev"]');
    expect(launcher).not.toContain('"node_modules", ".bin", "next"');
  });

  test("handles a Next startup failure without an unhandled error event", () => {
    expect(launcher).toContain('nextProcess.on("error"');
    expect(launcher).toContain("impossible de lancer Next.js");
  });
});
