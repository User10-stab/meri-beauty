import { describe, expect, it } from "vitest";
import { formatDurationLong, formatDurationShort } from "@/lib/format-duration";
import {
  emailVerificationEmail,
  staffMultipleReservationsConfirmedEmail,
  staffReservationCreatedEmail,
} from "@/lib/email-templates";

describe("formatDurationShort", () => {
  it("keeps short durations in minutes and switches to hours past 60", () => {
    expect(formatDurationShort(45)).toBe("45 min");
    expect(formatDurationShort(60)).toBe("1 h");
    expect(formatDurationShort(90)).toBe("1 h 30");
    expect(formatDurationShort(422)).toBe("7 h 02");
  });

  it("returns an empty string when there is no duration", () => {
    expect(formatDurationShort(null)).toBe("");
    expect(formatDurationShort(0)).toBe("");
  });
});

describe("formatDurationLong", () => {
  it("writes link expiries as a French sentence", () => {
    expect(formatDurationLong(15)).toBe("15 minutes");
    expect(formatDurationLong(1)).toBe("1 minute");
    expect(formatDurationLong(60)).toBe("1 heure");
    expect(formatDurationLong(24 * 60)).toBe("24 heures");
    expect(formatDurationLong(90)).toBe("1 heure 30 minutes");
    expect(formatDurationLong(72 * 60)).toBe("3 jours");
  });
});

describe("e-mails never print long durations in minutes", () => {
  it("24-hour verification links say 24 heures", () => {
    const email = emailVerificationEmail({
      customerName: "Cliente",
      verificationUrl: "https://example.com/verify",
      expiresInMinutes: 24 * 60,
    });
    expect(email.text).toContain("24 heures");
    expect(email.html).toContain("24 heures");
    expect(email.text + email.html).not.toContain("1440");
  });

  it("staff booking e-mails show service durations in hours", () => {
    const single = staffReservationCreatedEmail({
      staffName: "Marie",
      customerName: "Cliente",
      serviceName: "Extension de cils",
      date: new Date("2026-09-20T09:00:00Z"),
      time: "11:00",
      duration: 422,
      totalAmount: 100,
    });
    const multiple = staffMultipleReservationsConfirmedEmail({
      staffName: "Marie",
      customerName: "Cliente",
      totalAmount: 100,
      appointments: [{ serviceName: "Extension de cils", date: new Date("2026-09-20T09:00:00Z"), time: "11:00", duration: 422, amount: 100 }],
    });
    for (const email of [single, multiple]) {
      expect(email.text).toContain("7 h 02");
      expect(email.html).toContain("7 h 02");
      expect(email.text + email.html).not.toContain("422 min");
    }
  });
});
