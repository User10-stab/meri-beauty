import { describe, expect, test } from "vitest";
import { formatAvailableDays, ALL_WEEK_DAYS } from "@/lib/week-days";

describe("formatAvailableDays", () => {
  test("empty/null renders as 'Tous les jours'", () => {
    expect(formatAvailableDays([])).toBe("Tous les jours");
    expect(formatAvailableDays(null)).toBe("Tous les jours");
    expect(formatAvailableDays(undefined)).toBe("Tous les jours");
  });

  test("all 7 days also renders as 'Tous les jours'", () => {
    expect(formatAvailableDays(ALL_WEEK_DAYS)).toBe("Tous les jours");
  });

  test("a single day renders its French label", () => {
    expect(formatAvailableDays(["WEDNESDAY"])).toBe("Mercredi");
  });

  test("multiple days render in week order, not input order", () => {
    expect(formatAvailableDays(["FRIDAY", "MONDAY", "WEDNESDAY"])).toBe("Lundi, Mercredi, Vendredi");
  });

  test("duplicate entries are de-duplicated", () => {
    expect(formatAvailableDays(["MONDAY", "MONDAY"])).toBe("Lundi");
  });
});
