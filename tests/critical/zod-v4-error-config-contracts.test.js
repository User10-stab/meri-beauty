import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

// P0: this project is on Zod 4, where the old `{ required_error, invalid_type_error }`
// object shorthand compiles fine but is silently ignored at runtime — every
// affected field falls back to Zod's raw English default ("Invalid input:
// expected string, received undefined") instead of the intended French
// message. Confirmed directly against the installed zod version; a previous
// fix already documented this for a single field (rental-request.js's
// vatNumber) but 56 other occurrences across 10 files/3 action files were
// still broken until 17 Aug 2026. The correct replacement is the unified
// `error` param (a string, or `(issue) => ...` to distinguish "missing" from
// "wrong type"). This test scans every real source file (not build output)
// so the bug can't quietly come back in a new schema.
function listJsFiles(dir) {
  const entries = readdirSync(`${root}${dir}`, { withFileTypes: true });
  return entries.flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) return [];
    const relPath = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return listJsFiles(relPath);
    if (/\.(js|jsx|mjs)$/.test(entry.name)) return [relPath];
    return [];
  });
}

describe("no Zod schema uses the silently-ignored required_error/invalid_type_error config", () => {
  const dirsToScan = ["lib/validations", "actions", "lib"];
  const offenders = [];

  for (const dir of dirsToScan) {
    for (const file of listJsFiles(dir)) {
      const content = readFileSync(`${root}${file}`, "utf8");
      // Strip line comments before scanning, so an explanatory comment (like
      // the one in lib/validations/rental-request.js documenting this exact
      // trap) doesn't trip the check.
      const codeOnly = content
        .split("\n")
        .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
        .join("\n");
      if (/required_error|invalid_type_error/.test(codeOnly)) {
        offenders.push(file);
      }
    }
  }

  test("zero files under lib/validations, lib, or actions use the broken config keys", () => {
    expect(offenders).toEqual([]);
  });
});
