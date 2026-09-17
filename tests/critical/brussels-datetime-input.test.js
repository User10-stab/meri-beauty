import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseBrusselsInputValue, toBrusselsInputValue } from "@/lib/datetime/brussels-input";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");
const iso = (date) => date.toISOString();

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  process.env.TZ = ORIGINAL_TZ;
});

/**
 * 17/09/2026, prod: the formation/atelier edit forms showed UTC wall time and
 * saved it back as Brussels time, so every save moved every session 2h earlier
 * (summer) or 1h (winter). "Un après-midi chez Mamie" ended up at 04:00, a
 * Manucure Russe session at midnight.
 */
describe("a datetime-local value is Brussels wall-clock time", () => {
  it("summer (CEST, UTC+2) and winter (CET, UTC+1) both land on the right instant", () => {
    expect(iso(parseBrusselsInputValue("2026-10-23T09:00"))).toBe("2026-10-23T07:00:00.000Z");
    expect(iso(parseBrusselsInputValue("2026-11-26T09:00"))).toBe("2026-11-26T08:00:00.000Z");
  });

  it("the form shows what the client sees — the prod session stored at 22:00Z reads 00:00, not 22:00", () => {
    expect(toBrusselsInputValue(new Date("2026-10-22T22:00:00Z"))).toBe("2026-10-23T00:00");
    expect(toBrusselsInputValue(new Date("2026-11-26T06:00:00Z"))).toBe("2026-11-26T07:00");
    expect(toBrusselsInputValue("2026-10-11T02:00:00.000Z")).toBe("2026-10-11T04:00");
  });

  it("saving a form without touching it never moves the session — not once, not ten times", () => {
    for (const typed of ["2026-10-11T14:00", "2026-11-26T09:00", "2026-12-18T19:00", "2026-03-15T10:30"]) {
      let value = typed;
      for (let save = 0; save < 10; save += 1) value = toBrusselsInputValue(parseBrusselsInputValue(value));
      expect(value).toBe(typed);
    }
  });

  it("the old prefill is exactly what drifted: UTC slice, re-read as Brussels, lands 2h early", () => {
    const stored = parseBrusselsInputValue("2026-10-11T14:00");
    const oldPrefill = stored.toISOString().slice(0, 16); // "2026-10-11T12:00"
    expect(toBrusselsInputValue(parseBrusselsInputValue(oldPrefill))).toBe("2026-10-11T12:00");
    expect(toBrusselsInputValue(stored)).toBe("2026-10-11T14:00");
  });

  it("does not depend on the server's or the browser's timezone", () => {
    for (const tz of ["UTC", "America/New_York", "Asia/Tokyo", "Europe/Brussels"]) {
      process.env.TZ = tz;
      expect(iso(parseBrusselsInputValue("2026-10-23T09:00"))).toBe("2026-10-23T07:00:00.000Z");
      expect(toBrusselsInputValue(new Date("2026-10-23T07:00:00Z"))).toBe("2026-10-23T09:00");
    }
  });

  it("the repeated autumn hour takes its earlier (summer) reading; a skipped spring hour resolves forward", () => {
    // 25/10/2026: clocks go back 03:00 → 02:00, so 02:30 happens twice.
    expect(iso(parseBrusselsInputValue("2026-10-25T02:30"))).toBe("2026-10-25T00:30:00.000Z");
    // 29/03/2026: clocks jump 02:00 → 03:00, so 02:30 never happens.
    expect(toBrusselsInputValue(parseBrusselsInputValue("2026-03-29T02:30"))).toBe("2026-03-29T03:30");
  });

  it("a string that already carries its zone is taken as the instant it names", () => {
    expect(iso(parseBrusselsInputValue("2026-10-23T07:00:00.000Z"))).toBe("2026-10-23T07:00:00.000Z");
    expect(iso(parseBrusselsInputValue("2026-10-23T09:00:00+02:00"))).toBe("2026-10-23T07:00:00.000Z");
  });

  it("empty and invalid input never become a date", () => {
    for (const value of [null, undefined, "", "   ", "pas une date"]) expect(parseBrusselsInputValue(value)).toBeNull();
    for (const value of [null, undefined, "", "pas une date"]) expect(toBrusselsInputValue(value)).toBe("");
  });
});

describe("every form and save path uses it", () => {
  it.each([
    "components/dashboard/formations/CreateFormationModal.jsx",
    "components/dashboard/workshops/CreateActivityModal.jsx",
  ])("%s prefills in Brussels time, never the UTC slice", (file) => {
    const content = source(file);
    expect(content).not.toContain(".toISOString().slice(0, 16)");
    expect(content).toContain("toBrusselsInputValue(");
  });

  it.each(["actions/formations/create-formation.js", "actions/workshops/create-activity.js"])(
    "%s reads session dates as Brussels time, explicitly",
    (file) => {
      const content = source(file);
      expect(content).not.toMatch(/new Date\(s\.(startDate|endDate|registrationDeadline)\)/);
      expect(content).toContain("startDate: parseBrusselsInputValue(s.startDate)");
      expect(content).toContain("parseBrusselsInputValue(s.registrationDeadline)");
    }
  );

  it("the promo-code expiry uses the same pair", () => {
    expect(source("components/dashboard/promo-codes/PromoCodeModal.jsx")).toContain("toBrusselsInputValue(promoCode?.expiresAt)");
    expect(source("lib/validations/promo-codes.js")).toContain("parseBrusselsInputValue(value)");
  });
});
