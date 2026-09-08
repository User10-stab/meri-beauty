import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

function messages(locale) {
  return JSON.parse(readFileSync(`${root}messages/${locale}.json`, "utf8"));
}

describe("workshop activity-modal translations", () => {
  test("labels both activity types in every supported locale", () => {
    for (const locale of ["fr", "en", "nl"]) {
      const modal = messages(locale).dashboardWorkshops.activities.modal;
      expect(modal.typeWorkshop).toEqual(expect.any(String));
      expect(modal.typeEvent).toEqual(expect.any(String));
      expect(modal.typeWorkshop).not.toBe("");
      expect(modal.typeEvent).not.toBe("");
    }
  });
});
