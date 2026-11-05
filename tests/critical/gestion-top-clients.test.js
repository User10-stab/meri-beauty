import { describe, expect, it } from "vitest";
import { buildTopClients, formatClientCount } from "@/lib/gestion/top-clients";

const row = (
  category,
  amountTtc,
  customerName,
  customerEmail = null,
  isRefund = false,
) => ({
  category,
  amountTtc,
  customerName,
  customerEmail,
  isRefund,
});

describe("buildTopClients", () => {
  it("ranks clients per category by what they paid, net of refunds", () => {
    const groups = buildTopClients([
      row("ORDER", 50, "Alice", "alice@x.be"),
      row("ORDER", 30, "Alice", "ALICE@x.be"), // same client, email case differs
      row("ORDER", 60, "Bob", "bob@x.be"),
      row("ORDER", 20, "Bob", "bob@x.be", true), // refund
      row("APPOINTMENT", 90, "Chloé", "chloe@x.be"),
      row("STAFF_RENT", 900, "Staff", "staff@x.be"), // not a client sale
      row("ORDER", 100, null, null), // anonymous till sale
    ]);

    expect(groups.map((g) => g.category)).toEqual([
      "ORDER",
      "APPOINTMENT",
      "FORMATION",
      "WORKSHOP",
      "EVENT",
    ]);
    const orders = groups.find((g) => g.category === "ORDER").clients;
    expect(orders.map((c) => [c.name, c.amountTtc])).toEqual([
      ["Alice", 80],
      ["Bob", 40],
    ]);
    expect(
      groups.find((g) => g.category === "APPOINTMENT").clients[0].name,
    ).toBe("Chloé");
    expect(groups.find((g) => g.category === "FORMATION").clients).toEqual([]);
  });

  it("counts distinct payments: an acompte + solde is one, a fully refunded payment is none", () => {
    const pay = (paymentId, amountTtc, isRefund = false) => ({
      ...row("APPOINTMENT", amountTtc, "Dana", "dana@x.be", isRefund),
      paymentId,
    });
    const [rdv] = buildTopClients(
      [
        pay("p1", 20), // acompte
        pay("p1", 40), // solde of the same visit
        pay("p2", 50),
        pay("p3", 30),
        pay("p3", 30, true), // refunded in full
      ],
      "APPOINTMENT",
    );
    expect(rdv.clients[0]).toMatchObject({
      name: "Dana",
      amountTtc: 110,
      count: 2,
    });
    expect(rdv.clients[0].visits.map((v) => [v.id, v.amountTtc])).toEqual([
      ["p1", 60],
      ["p2", 50],
    ]);
    expect(formatClientCount("APPOINTMENT", 2)).toBe("2 visites");
    expect(formatClientCount("ORDER", 1)).toBe("1 commande");
  });

  it("keeps the top 5 only, and drops fully refunded clients", () => {
    const rows = ["A", "B", "C", "D", "E", "F"].map((n, i) =>
      row("EVENT", 10 * (i + 1), n),
    );
    rows.push(row("EVENT", 70, "G"), row("EVENT", 70, "G", null, true));
    const events = buildTopClients(rows).find(
      (g) => g.category === "EVENT",
    ).clients;
    expect(events.map((c) => c.name)).toEqual(["F", "E", "D", "C", "B"]);
  });

  it("returns only the filtered category", () => {
    expect(
      buildTopClients([row("ORDER", 10, "A")], "WORKSHOP").map(
        (g) => g.category,
      ),
    ).toEqual(["WORKSHOP"]);
    expect(buildTopClients([], "STAFF_RENT")).toEqual([]);
  });
});
