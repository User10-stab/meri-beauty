import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import ts from "typescript";

const root = fileURLToPath(new URL("../../", import.meta.url));

/**
 * The dashboard's source files must actually parse.
 *
 * Most contract tests in this suite read a file as a **string** and assert on
 * substrings. That is the right tool for "the screen must not promise a refund
 * the server never sends" — but it means a file can be syntactically broken and
 * every one of those tests still passes, because a broken file is still a
 * string containing the right words.
 *
 * That happened: an automated edit left a duplicated `if (...) {` in
 * AdminOperationsClient.jsx, so the module had one unclosed brace. The whole
 * unit suite stayed green — 1,224 passing — while the Opérations page served
 * nothing but Next's build-error overlay. It surfaced only when a browser test
 * tried to click through the overlay, several steps and one restarted dev
 * server later.
 *
 * A parse is not a type-check and is not a build. It is the cheapest possible
 * answer to "is this file still a file", which is the exact gap above.
 */

const DIRECTORIES = ["actions", "lib", "components/dashboard"];
const EXTENSIONS = [".js", ".jsx", ".mjs"];

function collect(dir, found = []) {
  for (const entry of readdirSync(join(root, dir))) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const rel = `${dir}/${entry}`;
    const full = join(root, rel);
    if (statSync(full).isDirectory()) collect(rel, found);
    else if (EXTENSIONS.some((ext) => entry.endsWith(ext))) found.push(rel);
  }
  return found;
}

const files = DIRECTORIES.flatMap((dir) => collect(dir));

describe("every dashboard source file parses", () => {
  test("the sweep actually found files to check", () => {
    // A collector that silently returns nothing would make this whole suite a
    // no-op that reports success.
    expect(files.length).toBeGreaterThan(100);
  });

  test("no file has a syntax error", () => {
    const broken = [];
    for (const file of files) {
      const source = readFileSync(join(root, file), "utf8");
      const parsed = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith(".jsx") ? ts.ScriptKind.JSX : ts.ScriptKind.JS,
      );
      const diagnostics = parsed.parseDiagnostics ?? [];
      if (diagnostics.length === 0) continue;
      const first = diagnostics[0];
      const { line } = parsed.getLineAndCharacterOfPosition(first.start);
      broken.push(
        `${relative(".", file)}:${line + 1} — ${ts.flattenDiagnosticMessageText(first.messageText, " ")}`,
      );
    }
    expect(broken, `files that do not parse:\n  ${broken.join("\n  ")}`).toEqual([]);
  });
});
