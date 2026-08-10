import { readFileSync } from "node:fs";
import { config, parse } from "dotenv";

// Load the real .env first so we have something to compare the test branch
// against below — never assigned to DATABASE_URL until we're sure it's safe.
config();
const realDatabaseUrl = process.env.DATABASE_URL;

const testEnv = parse(readFileSync(".env.test.local", "utf8"));
const testDatabaseUrl = testEnv.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error(
    "TEST_DATABASE_URL is not set in .env.test.local — put a disposable " +
      "Neon branch connection string there before running npm run test:integration. " +
      "See tests/integration/README.md.",
  );
}

// Safety rail: if the branch URL ever accidentally equals the real one (e.g.
// .env.test.local misconfigured to point at production), refuse to run
// rather than silently reserving stock / creating orders against real data.
if (testDatabaseUrl === realDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL must not equal the real DATABASE_URL.");
}

// actions/*.js and lib/prisma.js all read DATABASE_URL implicitly (via
// `new PrismaClient()`), so the only way to point the app's real singleton
// at the test branch — without ever touching the real DATABASE_URL — is to
// override the env var itself before anything imports @/lib/prisma. This
// file is a Vitest setupFile, which Vitest guarantees runs before the test
// file's own imports are evaluated.
process.env.DATABASE_URL = testDatabaseUrl;
process.env.TEST_DATABASE_URL = testDatabaseUrl;
