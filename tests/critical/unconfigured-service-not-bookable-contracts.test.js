import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

// assignServiceToMe (and the equivalent staff-creation paths) create a
// StaffService with isActive: true but price: 0 / duration: 0, meant to be
// configured later. Nothing downstream filtered on price/duration, so a
// staff member could go live with a free, instant, publicly bookable slot
// the moment working hours existed — before ever setting a real price.
describe("a staffService with price/duration still at 0 is not publicly bookable", () => {
  test("assignServiceToMe still creates the unconfigured placeholder row", () => {
    const src = source("actions/services/assign-service-to-me.js");
    expect(src).toContain("price: 0");
    expect(src).toContain("duration: 0");
  });

  test("getStaffByService excludes unconfigured (price/duration 0) rows from the public listing", () => {
    const src = source("actions/reservation/get-staff-by-service.js");
    const whereIdx = src.indexOf("staffServices = await prisma.staffService.findMany");
    const closeIdx = src.indexOf("include:", whereIdx);
    const whereBody = src.slice(whereIdx, closeIdx);
    expect(whereBody).toContain("price: { gt: 0 }");
    expect(whereBody).toContain("duration: { gt: 0 }");
  });

  test("createReservation rejects booking an unconfigured service server-side, not just in the listing", () => {
    const src = source("actions/reservation/create-reservation.js");
    expect(src).toContain("Number(staffService.price) <= 0 || Number(staffService.duration) <= 0");
  });

  test("createReservations (multi) rejects the same, per-appointment", () => {
    const src = source("actions/reservation/create-reservation.js");
    expect(src).toContain("Number(ss.price) <= 0 || Number(ss.duration) <= 0");
  });
});
