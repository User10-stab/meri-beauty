import { roundMoney, calculateVatTotals, resolveGoodsVatPolicy, resolveServiceVatPolicy } from "@/lib/tax-policy";
import { categoryForPayment, customerForPayment, PAYMENT_CATEGORY_LABELS } from "@/lib/payments/payment-category";
import { resolveSalonScope } from "@/lib/authorization/salon-scope";
import {
  METHOD_LABELS,
  RECETTES_METHODS,
  RECETTES_CATEGORIES,
  RECETTES_CATEGORY_LABELS,
  MAX_JOURNAL_ROWS,
} from "@/lib/livre-de-recettes/filters";

// Fields resolveGoodsVatPolicy/resolveServiceVatPolicy need to work out the
// applicable rate for a payment that has no invoice yet — dropping any of
// the three VAT ones silently forces every such row to the domestic rate,
// since resolveForeignEuVatPolicy can then never see a validated foreign-EU
// company. fullName/email are for the row's own customer columns.
const CUSTOMER_SELECT = { fullName: true, email: true, isCompany: true, vatNumber: true, vatValidatedAt: true };

/**
 * The "livre de recettes": every payment the SALON received over an
 * arbitrary date range, one row per Transaction, across every payment
 * method — Espèces, Carte and En ligne alike — with a running cumulative
 * balance.
 *
 * "The salon" is the load-bearing word. Every practitioner here is legally
 * independent (`Staff.type = INDEPENDENT`) with their own VAT number, so a
 * sale one of them collects belongs in *their* books, not in this one —
 * counting it here overstates the salon's declared turnover. Scope is
 * therefore restricted to `resolveSalonScope()`: the ADMIN/OWNER accounts
 * and Marie Mercier (`TILL_CASH_OPERATOR_EMAIL`), whose VAT number is the
 * salon's own despite her `STAFF` role. Online purchases a customer makes
 * herself carry no staff at all and are salon revenue too. See
 * lib/authorization/salon-scope.js — never re-derive that rule here.
 *
 * Where it still differs from the Livre de CAISSE: the cash book is one
 * till session, CASH only, and on-till only (`pieceNumber: { not: null }`),
 * so it omits every card and online payment. Those are real salon revenue
 * and belong here.
 *
 * Method/category bucketing follows the exact same conventions as the X/Z
 * day report (lib/cash-book/build-day-report.js): a REFUND is a sign-flipped
 * ledger event netted off its own method, not dropped; `isDeleted` rows are
 * excluded. VAT is backed out of each transaction's own amount at its
 * invoice's rate once one exists; before that, the same policy an invoice
 * would use (resolveGoodsVatPolicy/resolveServiceVatPolicy — Belgian or
 * unvalidated customer at 21%, a VIES-validated foreign-EU company at 0%) is
 * applied directly, so HT/TVA are never blank.
 *
 * Kept out of any "use server" module so it can be unit-tested against a
 * plain mocked client — see actions/dashboard/get-recettes-journal.js for
 * the auth-gated wrapper.
 *
 * @param {import("@prisma/client").PrismaClient} client
 * @param {{ from: string, to: string, fromDate: Date, toDate: Date,
 *   method: "ALL"|"CASH"|"CARD"|"ONLINE", category: "ALL"|string,
 *   staffId?: string, staffName?: string|null }} params
 *   `staffId` deliberately overrides the salon scope: an admin asking for one
 *   practitioner's lines wants exactly those, including an independent's.
 */
export async function buildRecettesJournal(client, { from, to, fromDate, toDate, method, category, staffId = "", staffName = null }) {
  // Resolved before the query so the scope lands in the `where` — filtering
  // afterwards would make `truncated` and every total lie about what was cut.
  const scope = staffId ? null : await resolveSalonScope(client);

  const found = await client.transaction.findMany({
    where: {
      paidAt: { gte: fromDate, lte: toDate },
      isDeleted: false,
      ...(method !== "ALL" ? { method } : {}),
      ...(staffId
        ? // Explicit staff scope: only transactions behind that member's
          // appointment payments (boutique/order transactions carry no staff).
          { payment: { appointment: { staffService: { staffId } } } }
        : {
            // Default scope: the salon's own takings. The two id spaces are
            // not interchangeable — an Order is stamped with a `User.id`, an
            // Appointment with a `Staff.id` — so each arm keys on its own.
            payment: {
              OR: [
                { order: { createdByStaffId: { in: scope.salonUserIds } } },
                // A customer buying online stamps no one: salon revenue.
                { order: { createdByStaffId: null } },
                { appointment: { staffId: { in: scope.salonStaffIds } } },
                // Ateliers and formations are the salon's own events — they
                // carry no staff link in the schema at all (the animator is
                // matched by e-mail, with no foreign key), so there is
                // nothing here to attribute to an independent.
                { workshopReservationId: { not: null } },
                { formationReservationId: { not: null } },
                // A payment attached to none of the four sources (the OTHER
                // bucket below) has no owner to hand it to; the salon is the
                // default owner, same reasoning as an unstamped order.
                {
                  orderId: null,
                  appointmentId: null,
                  workshopReservationId: null,
                  formationReservationId: null,
                },
              ],
            },
          }),
    },
    orderBy: [{ paidAt: "asc" }, { id: "asc" }],
    take: MAX_JOURNAL_ROWS + 1,
    include: {
      payment: {
        include: {
          invoice: { select: { number: true, vatRate: true } },
          order: { select: { orderNumber: true, user: { select: CUSTOMER_SELECT } } },
          appointment: {
            select: {
              user: { select: CUSTOMER_SELECT },
              staffService: { select: { service: { select: { name: true } } } },
            },
          },
          workshopReservation: {
            select: {
              customer: { select: CUSTOMER_SELECT },
              session: { select: { workshop: { select: { title: true, type: true } } } },
            },
          },
          formationReservation: {
            select: {
              customer: { select: CUSTOMER_SELECT },
              session: { select: { formation: { select: { title: true } } } },
            },
          },
        },
      },
    },
  });

  const truncated = found.length > MAX_JOURNAL_ROWS;
  const transactions = truncated ? found.slice(0, MAX_JOURNAL_ROWS) : found;

  const byMethod = Object.fromEntries(RECETTES_METHODS.map((m) => [m, { net: 0, refunded: 0 }]));
  const byCategory = {};
  let grossInflow = 0;
  let refundTotal = 0;
  let running = 0;

  const rows = [];

  for (const transaction of transactions) {
    const catCode = categoryForPayment(transaction.payment) ?? "OTHER";
    // The polymorphic Payment has no clean Prisma path to its category, so
    // this filter is applied in memory — same reason build-day-report walks
    // the relation in JS rather than in the query.
    if (category !== "ALL" && catCode !== category) continue;

    const amount = Number(transaction.amount);
    const isRefund = transaction.transactionType === "REFUND";
    const sign = isRefund ? -1 : 1;
    const signed = roundMoney(sign * amount);

    running = roundMoney(running + signed);

    if (isRefund) refundTotal = roundMoney(refundTotal + amount);
    else grossInflow = roundMoney(grossInflow + amount);

    if (byMethod[transaction.method]) {
      if (isRefund) {
        byMethod[transaction.method].refunded = roundMoney(byMethod[transaction.method].refunded + amount);
        byMethod[transaction.method].net = roundMoney(byMethod[transaction.method].net - amount);
      } else {
        byMethod[transaction.method].net = roundMoney(byMethod[transaction.method].net + amount);
      }
    }

    byCategory[catCode] = roundMoney((byCategory[catCode] ?? 0) + signed);

    const customer = customerForPayment(transaction.payment);

    // An issued invoice's rate is an immutable snapshot — always authoritative
    // once it exists. Before that, apply the exact same policy an invoice
    // would use, so the column is never blank while waiting on invoicing.
    const invoiceVatRate =
      transaction.payment?.invoice?.vatRate != null ? Number(transaction.payment.invoice.vatRate) : null;
    const vatRate =
      invoiceVatRate ??
      (catCode === "ORDER"
        ? resolveGoodsVatPolicy({ customer }).vatRate
        : resolveServiceVatPolicy({ customer }).vatRate);
    const vatSource = invoiceVatRate != null ? "invoice" : "estimated";

    const vatTotals = calculateVatTotals(amount, vatRate);
    const amountHt = vatTotals.totalExclVat;
    const amountVat = vatTotals.vatAmount;

    rows.push({
      id: transaction.id,
      paidAt: transaction.paidAt,
      pieceNumber: transaction.pieceNumber ?? null,
      reference:
        transaction.manualReference ??
        transaction.payment?.invoice?.number ??
        transaction.stripePaymentIntentId ??
        null,
      customerName: customer?.fullName ?? null,
      customerEmail: customer?.email ?? null,
      category: catCode,
      categoryLabel: RECETTES_CATEGORY_LABELS[catCode] ?? catCode,
      label: labelForPayment(transaction.payment, { isRefund }),
      method: transaction.method,
      methodLabel: METHOD_LABELS[transaction.method] ?? transaction.method,
      transactionType: transaction.transactionType,
      isRefund,
      // Kept for the column and the exports, but structurally always false
      // now: off-till cash is by definition cash an independent took, and
      // the scope above no longer lets those rows into this journal. It
      // stays so the divergence stays visible if the scope ever widens.
      offTill: transaction.method === "CASH" && transaction.cashSessionId == null,
      amountTtc: amount,
      amountHt,
      amountVat,
      vatRate,
      vatSource,
      signedAmount: signed,
      runningTotal: running,
    });
  }

  return {
    filters: {
      from,
      to,
      method,
      category,
      staffId,
      staffName,
      methodLabel: method === "ALL" ? "Tous les moyens" : METHOD_LABELS[method] ?? method,
      categoryLabel: category === "ALL" ? "Toutes les catégories" : RECETTES_CATEGORY_LABELS[category] ?? category,
    },
    generatedAt: new Date(),
    truncated,
    rows,
    summary: {
      count: rows.length,
      total: roundMoney(grossInflow - refundTotal),
      grossInflow,
      refundTotal,
      byMethod: RECETTES_METHODS.map((m) => ({
        method: m,
        label: METHOD_LABELS[m] ?? m,
        net: byMethod[m].net,
        refunded: byMethod[m].refunded,
      })),
      byCategory: RECETTES_CATEGORIES.concat("OTHER")
        .filter((c) => byCategory[c] != null)
        .map((c) => ({
          category: c,
          label: RECETTES_CATEGORY_LABELS[c] ?? c,
          net: byCategory[c],
        })),
    },
  };
}

function labelForPayment(payment, { isRefund }) {
  const prefix = isRefund ? "Remboursement — " : "";
  if (!payment) return `${prefix}Vente`;
  if (payment.order) return `${prefix}Vente produits — commande n°${payment.order.orderNumber}`;
  if (payment.appointment) {
    const service = payment.appointment.staffService?.service?.name;
    return `${prefix}Rendez-vous${service ? ` — ${service}` : ""}`;
  }
  if (payment.workshopReservation) {
    const workshop = payment.workshopReservation.session?.workshop;
    const noun = workshop?.type === "EVENT" ? "Événement" : "Atelier";
    return `${prefix}${noun}${workshop?.title ? ` — ${workshop.title}` : ""}`;
  }
  if (payment.formationReservation) {
    const title = payment.formationReservation.session?.formation?.title;
    return `${prefix}Formation${title ? ` — ${title}` : ""}`;
  }
  return `${prefix}Vente`;
}
