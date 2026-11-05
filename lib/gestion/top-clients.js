import { roundMoney } from "@/lib/tax-policy";
import { RECETTES_CATEGORY_LABELS } from "@/lib/livre-de-recettes/filters";

/**
 * The categories the Gestion page ranks clients in: the salon's own sales to
 * its clients (products, Marie's appointments and formations, ateliers,
 * événements). Staff rent is not a client sale, so it is left out.
 */
export const TOP_CLIENT_CATEGORIES = ["ORDER", "APPOINTMENT", "FORMATION", "WORKSHOP", "EVENT"];

export const TOP_CLIENTS_LIMIT = 5;

/** What one `count` is, per category: [singular, plural]. */
const COUNT_UNITS = {
  ORDER: ["commande", "commandes"],
  APPOINTMENT: ["visite", "visites"],
  FORMATION: ["inscription", "inscriptions"],
  WORKSHOP: ["réservation", "réservations"],
  EVENT: ["réservation", "réservations"],
};

/** "3 visites", "1 commande"… — shared by the page and the exports. */
export function formatClientCount(category, count) {
  const [one, many] = COUNT_UNITS[category] ?? ["fois", "fois"];
  return `${count} ${count > 1 ? many : one}`;
}

/**
 * The best clients of each category over the period, by what they paid (TTC,
 * net of refunds): who to offer a promo to. Built from the Livre de recettes
 * rows the report already loaded, so the amounts add up to its turnover.
 *
 * A client is recognised by email (lower-cased), else by name. A sale with no
 * named client (an anonymous till sale) is not ranked.
 *
 * `count` is how many times the client bought in the category: distinct
 * payments (one order, one visit, one reservation), so an acompte + solde
 * counts once and a fully refunded payment does not count. `visits` lists
 * them (date, label, net amount), most recent first, for the page's detail.
 *
 * With a category filter, only that category is returned.
 *
 * @param {Array<{ id?: string, paymentId?: string|null, paidAt?: Date|string, label?: string, category: string, isRefund: boolean, amountTtc: number, customerName: string|null, customerEmail: string|null }>} rows
 * @param {"ALL"|string} category
 */
export function buildTopClients(rows, category = "ALL", limit = TOP_CLIENTS_LIMIT) {
  const wanted = category === "ALL" ? TOP_CLIENT_CATEGORIES : TOP_CLIENT_CATEGORIES.filter((c) => c === category);
  const byCategory = new Map(wanted.map((c) => [c, new Map()]));

  for (const row of rows) {
    const clients = byCategory.get(row.category);
    if (!clients) continue;
    const email = row.customerEmail?.trim() || null;
    const name = row.customerName?.trim() || null;
    const key = email ? `e:${email.toLowerCase()}` : name ? `n:${name.toLowerCase()}` : null;
    if (!key) continue;

    let client = clients.get(key);
    if (!client) {
      client = { key, name: name ?? email, email, amountTtc: 0, byPayment: new Map() };
      clients.set(key, client);
    }
    if (!client.email && email) client.email = email;
    const signed = (row.isRefund ? -1 : 1) * (Number(row.amountTtc) || 0);
    client.amountTtc += signed;
    const paymentKey = row.paymentId ?? row.id;
    let payment = client.byPayment.get(paymentKey);
    if (!payment) {
      payment = { id: paymentKey, paidAt: null, label: null, amountTtc: 0 };
      client.byPayment.set(paymentKey, payment);
    }
    payment.amountTtc += signed;
    // The date and label of a visit are those of its first (non-refund) payment.
    if (!row.isRefund && (payment.paidAt == null || new Date(row.paidAt) < new Date(payment.paidAt))) {
      payment.paidAt = row.paidAt ?? null;
      payment.label = row.label ?? null;
    }
  }

  return wanted.map((code) => ({
    category: code,
    label: RECETTES_CATEGORY_LABELS[code] ?? code,
    clients: [...byCategory.get(code).values()]
      .map(({ byPayment, ...client }) => {
        const visits = [...byPayment.values()]
          .map((payment) => ({ ...payment, amountTtc: roundMoney(payment.amountTtc) }))
          .filter((payment) => payment.amountTtc > 0)
          .sort((a, b) => new Date(b.paidAt ?? 0) - new Date(a.paidAt ?? 0));
        return { ...client, amountTtc: roundMoney(client.amountTtc), count: visits.length, visits };
      })
      .filter((client) => client.amountTtc > 0)
      .sort((a, b) => b.amountTtc - a.amountTtc || a.name.localeCompare(b.name, "fr"))
      .slice(0, limit),
  }));
}
