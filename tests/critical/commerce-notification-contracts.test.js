import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

describe("commerce creation notifications", () => {
  test("defines pending-payment notifications for purchases, workshops and formations", () => {
    const notifications = source("lib/notifications.js");
    expect(notifications).toContain("buildOrderCreatedNotification");
    expect(notifications).toContain("buildWorkshopReservationCreatedNotification");
    expect(notifications).toContain("buildFormationReservationCreatedNotification");
    expect(notifications).toContain('type: "PAYMENT_PENDING"');
  });

  test("notifies active admins when an order is created, including pay-on-site pickup", () => {
    const orders = source("actions/boutique/orders.js");
    expect(orders).toContain("buildOrderCreatedNotification");
    expect(orders).toContain("getSalonAdminNotificationRecipients({ tx })");
    expect(orders).toContain("createNotificationsBulk(");
    expect(orders).toContain('status: isOnSite ? "PENDING_PICKUP" : "PENDING_PAYMENT"');
  });

  test("notifies the admins and permitted assigned staff for workshops/events and formations", () => {
    const workshops = source("actions/workshops/create-workshop-reservation.js");
    const formations = source("actions/formations/create-formation-reservation.js");

    expect(workshops).toContain("buildWorkshopReservationCreatedNotification");
    expect(workshops).toContain("STAFF_PERMISSIONS.WORKSHOP_RESERVATIONS");
    expect(formations).toContain("buildFormationReservationCreatedNotification");
    expect(formations).toContain("STAFF_PERMISSIONS.FORMATION_RESERVATIONS");
  });
});
