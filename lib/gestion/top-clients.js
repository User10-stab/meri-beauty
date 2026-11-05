import { roundMoney } from "@/lib/tax-policy";
import { RECETTES_CATEGORY_LABELS } from "@/lib/livre-de-recettes/filters";

/**
 * The categories the Gestion page ranks clients in: the salon's own sales to
 * its clients (products, Marie's appointments and formations, ateliers,
 * événements). Staff rent is not a client sale, so it is left out.
 */
export const TOP_CLIENT_CATEGORIES = ["ORDER", "APPOINTMENT", "FORMATION", "WORKSHOP", "EVENT"];

export const TOP_CLIENTS_LIMIT = 5;

/**
 * The best clients of each category over the period, by what they paid (TTC,
 * net of refunds): who to offer a promo to. Built from the Livre de recettes
 * rows the report already loaded, so the amounts add up to its turnover.
 *
 * A client is recognised by email (lower-cased), else by name. A sale with no
 * named client (an anonymous till sale) is not ranked.
 *
 * With a category filter, only that category is returned.
 *
 * @param {Array<{ category: string, isRefund: boolean, amountTtc: number, customerName: string|null, customerEmail: string|null }>} rows
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
      client = { key, name: name ?? email, email, amountTtc: 0 };
      clients.set(key, client);
    }
    if (!client.email && email) client.email = email;
    client.amountTtc += (row.isRefund ? -1 : 1) * (Number(row.amountTtc) || 0);
  }

  return wanted.map((code) => ({
    category: code,
    label: RECETTES_CATEGORY_LABELS[code] ?? code,
    clients: [...byCategory.get(code).values()]
      .map((client) => ({ ...client, amountTtc: roundMoney(client.amountTtc) }))
      .filter((client) => client.amountTtc > 0)
      .sort((a, b) => b.amountTtc - a.amountTtc || a.name.localeCompare(b.name, "fr"))
      .slice(0, limit),
  }));
}
