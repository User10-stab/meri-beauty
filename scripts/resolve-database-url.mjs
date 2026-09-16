/**
 * Which database a maintenance script is about to write to — resolved
 * explicitly, and printable before anything runs.
 *
 * The bug this exists to prevent: `import` is hoisted and evaluated before
 * any statement in a module's body, and `@prisma/client` loads `.env` into
 * `process.env` as it initialises. dotenv does not overwrite a variable that
 * is already set. So a script written the obvious way —
 *
 *     import { config } from "dotenv";
 *     import { PrismaClient } from "@prisma/client";
 *     config({ path: [".env.local", ".env"] });   // too late, every time
 *
 * — silently connects to whatever `.env` names, even though `.env.local`
 * overrides it everywhere else in this app. Both of these scripts rewrite
 * ticket numbers in place; pointing one at the wrong database is not a
 * mistake that announces itself.
 *
 * Two rules make it deterministic:
 *
 *   1. This module is imported BEFORE `@prisma/client` in every script that
 *      uses it, so the snapshot below is the value the CALLER exported, not
 *      one Prisma loaded from a file. Keep it first in the import list.
 *   2. The env FILES are parsed here directly, never read back out of
 *      `process.env`, which by then is polluted.
 *
 * The resolved URL must then be handed to `new PrismaClient({ datasources:
 * { db: { url } } })`. Constructing PrismaClient with no argument re-reads
 * the polluted `process.env` and throws all of this away.
 *
 * Precedence, highest first:
 *   --database-url=<url>   an explicit choice on the command line
 *   $DATABASE_URL          exported by the caller before node started
 *   .env.local             what `next dev` itself would use
 *   .env                   the fallback, and what production has
 */

import { existsSync, readFileSync } from "node:fs";
import dotenv from "dotenv";

// Snapshot taken at module load — see rule 1 above. A later read of
// process.env.DATABASE_URL cannot tell a caller's export apart from the
// value Prisma loaded out of `.env`.
const CALLER_URL = process.env.DATABASE_URL;

const FLAG = "--database-url=";

/**
 * @param {string[]} [argv]
 * @returns {{ url: string|null, from: string }} `from` names the source, so
 *   a script can print where its target came from and not just what it is.
 */
export function resolveDatabaseUrl(argv = process.argv) {
  const flag = argv.find((arg) => arg.startsWith(FLAG));
  if (flag) {
    const url = flag.slice(FLAG.length);
    return { url: url || null, from: FLAG.slice(0, -1) };
  }

  if (CALLER_URL) return { url: CALLER_URL, from: "$DATABASE_URL" };

  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    const parsed = dotenv.parse(readFileSync(file));
    if (parsed.DATABASE_URL) return { url: parsed.DATABASE_URL, from: file };
  }

  return { url: null, from: "(introuvable)" };
}

/** host/database, with the credentials left out — this gets printed. */
export function describeTarget(url) {
  const m = (url ?? "").match(/@([^/?]+)\/([^?]+)/);
  return m ? `${m[1]}/${m[2]}` : "(illisible)";
}
