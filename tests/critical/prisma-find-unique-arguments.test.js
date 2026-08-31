import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(js|jsx)$/.test(entry)) out.push(full);
  }
  return out;
}

// 31 Aug 2026: the production error log carried a repeating Prisma crash —
// "Unknown argument `orderBy`" — that turned out to be the newsletter
// dashboard, not the module being investigated at the time. Both newsletter
// actions passed orderBy to findUnique, which returns at most one row and
// rejects the argument outright, so every call threw.
//
// findUnique/findUniqueOrThrow accept no orderBy at the top level. This is
// invisible until the query actually runs, so it is worth a static check.
describe("findUnique is never given an orderBy", () => {
  const files = [
    ...walk(join(root, "actions")),
    ...walk(join(root, "lib")),
    ...walk(join(root, "app")),
  ];

  test("no findUnique call passes orderBy at its top level", () => {
    const offenders = [];

    for (const file of files) {
      const src = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
      // Match findUnique( ... ) up to the first closing "});" and look for an
      // orderBy that is not nested inside a deeper object (include/select).
      const re = /findUnique(?:OrThrow)?\(\{([\s\S]*?)\n\s*\}\)/g;
      let m;
      while ((m = re.exec(src)) !== null) {
        const body = m[1];
        // Top-level keys sit at one indent level inside the call. A nested
        // relation's orderBy is indented deeper, so anchor on the shallowest.
        const lines = body.split("\n").filter((l) => l.trim());
        if (!lines.length) continue;
        const baseIndent = Math.min(...lines.map((l) => l.match(/^\s*/)[0].length));
        const topLevelOrderBy = lines.some(
          (l) => l.match(/^\s*/)[0].length === baseIndent && /^\s*orderBy\s*:/.test(l)
        );
        if (topLevelOrderBy) {
          offenders.push(relative(root, file).replace(/\\/g, "/"));
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
