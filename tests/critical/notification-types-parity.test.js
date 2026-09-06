import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

/**
 * The Zod list of notification types has to match the Prisma enum exactly.
 *
 * When it did not, the symptom was not a rejected notification. Both
 * `createNotification` and `createNotificationsBulk` **throw** on an unknown
 * type, and `markAppointmentNoShow` creates its notifications inside the
 * same transaction that flips the appointment's status — so the throw rolled
 * the status change back too. Marking an absence failed every time, and the
 * database held zero NO_SHOW appointments as a result.
 *
 * The file already carried a comment asking whoever extended the enum to
 * update the list. That is exactly what did not happen, which is the
 * argument for deriving it here instead of asking again.
 */
describe("notification types stay in sync with the schema", () => {
  const schema = source("prisma/schema.prisma");
  const validations = source("lib/validations/notification.js");

  /** The `NotificationType` enum, straight out of schema.prisma. */
  const prismaTypes = (() => {
    const block = schema.slice(schema.indexOf("enum NotificationType"));
    const body = block.slice(0, block.indexOf("}"));
    return body
      .split("\n")
      .slice(1)
      .map((line) => line.trim())
      .filter((line) => /^[A-Z][A-Z0-9_]*$/.test(line));
  })();

  /** The list the Zod schema actually validates against. */
  const zodTypes = (() => {
    const start = validations.indexOf("const NOTIFICATION_TYPES = [");
    const body = validations.slice(start, validations.indexOf("];", start));
    return [...body.matchAll(/"([A-Z][A-Z0-9_]*)"/g)].map((match) => match[1]);
  })();

  test("the enum was parsed at all", () => {
    // Guards the guard: a parsing change that silently produced two empty
    // lists would make every assertion below trivially true.
    expect(prismaTypes.length).toBeGreaterThan(5);
    expect(zodTypes.length).toBeGreaterThan(5);
  });

  test("every schema type is accepted by the validator", () => {
    const missing = prismaTypes.filter((type) => !zodTypes.includes(type));
    expect(
      missing,
      `NotificationType values missing from lib/validations/notification.js: ${missing.join(", ")}. ` +
        "createNotification throws on an unknown type, and callers create notifications inside the " +
        "transaction that does the real work — so a missing entry does not drop a notification, it " +
        "rolls back whatever the user was trying to do.",
    ).toEqual([]);
  });

  test("the validator accepts nothing the database would reject", () => {
    const extra = zodTypes.filter((type) => !prismaTypes.includes(type));
    expect(
      extra,
      `types accepted by Zod but absent from the Prisma enum: ${extra.join(", ")}. ` +
        "These pass validation and then fail at the database, which moves the error later and makes it worse.",
    ).toEqual([]);
  });

  test("APPOINTMENT_NO_SHOW specifically, since that is the one that was broken", () => {
    expect(zodTypes).toContain("APPOINTMENT_NO_SHOW");
  });
});
