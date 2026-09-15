import { roundMoney } from "@/lib/tax-policy";
import { MAX_JOURNAL_ROWS } from "@/lib/cash-book/filters";

/**
 * Assembles the Livre de caisse over a date range: the opening float of
 * every till session that falls in the range, every CASH transaction
 * attached to those sessions, and every drawer movement, merged into one
 * chronological ledger with a running balance.
 *
 * Deliberately scoped to CASH only — mixing in CARD/ONLINE rows would make
 * the running "Solde" column meaningless, since those never touched this
 * drawer. Ateliers/événements/formations/rendez-vous all appear here
 * exactly when they were paid in cash; a card sale is still recorded (see
 * Transaction), just not in this drawer's own book. An invoiced (B2B) cash
 * sale is included the same as any other — the money is still physically in
 * the drawer, invoice or not, and this book's job is to say what's in the
 * drawer.
 *
 * A closed session's opening float already equals the previous session's
 * countedCash (see the auto-carry-forward between auto-open/auto-close), so
 * the running balance is carried CONTINUOUSLY across every session in range
 * rather than reset at each session boundary — several days read as one
 * ledger, exactly like the auto-open/close design intends. This assumes a
 * session rarely spans more than one calendar day, which the daily
 * auto-close (lib/cash-book/auto-session.js) guarantees in the normal case;
 * a session left open across a boundary by a missed auto-close would still
 * render (its OPENING row keeps its true openedAt), just with a balance that
 * starts slightly before the requested range.
 *
 * Kept out of any "use server" module so it can be unit-tested against a
 * plain mocked client instead of a real database — see
 * actions/dashboard/cash-book.js for the auth-gated wrapper.
 */
export async function buildCashBookLedger(client, { fromDate, toDate }) {
  const sessions = await client.cashSession.findMany({
    where: {
      openedAt: { lte: toDate },
      OR: [{ closedAt: null }, { closedAt: { gte: fromDate } }],
    },
    orderBy: { openedAt: "asc" },
  });

  if (sessions.length === 0) {
    return { sessions: [], rows: [], totals: { entrees: 0, sorties: 0, finalBalance: 0 } };
  }

  const sessionIds = sessions.map((s) => s.id);

  const [transactions, movements] = await Promise.all([
    client.transaction.findMany({
      where: {
        cashSessionId: { in: sessionIds },
        method: "CASH",
        isDeleted: false,
        pieceNumber: { not: null },
        paidAt: { gte: fromDate, lte: toDate },
      },
      include: {
        payment: {
          include: {
            invoice: { select: { number: true } },
            order: { select: { id: true, orderNumber: true } },
            appointment: {
              include: { staffService: { include: { service: { select: { name: true } } } } },
            },
            workshopReservation: {
              include: { session: { include: { workshop: { select: { title: true, type: true } } } } },
            },
            formationReservation: {
              include: { session: { include: { formation: { select: { title: true } } } } },
            },
          },
        },
      },
      orderBy: { paidAt: "asc" },
      take: MAX_JOURNAL_ROWS,
    }),
    client.cashMovement.findMany({
      where: { cashSessionId: { in: sessionIds }, occurredAt: { gte: fromDate, lte: toDate } },
      include: { recordedBy: { select: { fullName: true } } },
      orderBy: { occurredAt: "asc" },
      take: MAX_JOURNAL_ROWS,
    }),
  ]);

  const openingRows = sessions
    // Only sessions whose own opening actually falls in the visible window
    // get an OPENING row rendered — a session still open from before
    // fromDate contributes its balance silently (see module doc) rather
    // than showing a confusing "Solde initial" dated outside the range.
    .filter((session) => session.openedAt >= fromDate && session.openedAt <= toDate)
    .map((session) => sessionOpeningRow(session, sessions.length > 1));

  const rows = [...openingRows, ...transactions.map(transactionToRow), ...movements.map(movementToRow)];

  // A stable sort by date alone would leave same-instant rows (an opening
  // float and a sale recorded in the same tick, in tests or a very fast
  // double-submit) in query order, which happens to already put "Solde
  // initial" first — but relying on that would be an accident, not a
  // contract, so it's pinned explicitly.
  rows.sort((a, b) => {
    const diff = new Date(a.date).getTime() - new Date(b.date).getTime();
    if (diff !== 0) return diff;
    if (a.kind === "OPENING") return -1;
    if (b.kind === "OPENING") return 1;
    return 0;
  });

  // Seed the running balance with whatever a session already open before
  // fromDate had accumulated up to fromDate — see the module doc's note on
  // sessions spanning the range boundary. In the normal daily-auto-close
  // case this is always the first session's openingFloat exactly.
  const firstSession = sessions[0];
  let balance = firstSession.openedAt < fromDate ? Number(firstSession.openingFloat) : 0;

  const withBalance = rows.map((row) => {
    balance = roundMoney(balance + row.entree - row.sortie);
    return { ...row, solde: balance };
  });

  // Excludes OPENING rows: the float is each session's starting point, not a
  // transaction — including it would make "Total entrées" disagree with the
  // till-close reconciliation for the sessions in range.
  const totals = withBalance.reduce(
    (acc, row) => {
      if (row.kind === "OPENING") return acc;
      return { entrees: roundMoney(acc.entrees + row.entree), sorties: roundMoney(acc.sorties + row.sortie) };
    },
    { entrees: 0, sorties: 0 }
  );

  return {
    sessions: sessions.map((s) => ({
      id: s.id,
      openedAt: s.openedAt,
      closedAt: s.closedAt,
      openingFloat: Number(s.openingFloat),
      isAutoOpened: Boolean(s.isAutoOpened),
      isAutoClosed: Boolean(s.isAutoClosed),
    })),
    rows: withBalance,
    totals: { ...totals, finalBalance: balance },
  };
}

function sessionOpeningRow(session, labelWithDate) {
  const dateLabel = labelWithDate
    ? new Date(session.openedAt).toLocaleDateString("fr-FR", { timeZone: "Europe/Brussels" })
    : null;
  return {
    kind: "OPENING",
    date: session.openedAt,
    pieceNumber: null,
    reference: null,
    label: dateLabel ? `Solde initial — ${dateLabel}` : "Solde initial",
    entree: Number(session.openingFloat),
    sortie: 0,
    sessionId: session.id,
  };
}

function transactionToRow(transaction) {
  const isRefund = transaction.transactionType === "REFUND";
  const amount = Number(transaction.amount);
  return {
    kind: isRefund ? "REFUND" : "SALE",
    date: transaction.paidAt,
    pieceNumber: transaction.pieceNumber,
    reference: transaction.payment?.invoice?.number ?? null,
    label: labelForPayment(transaction.payment, { isRefund }),
    entree: isRefund ? 0 : amount,
    sortie: isRefund ? amount : 0,
    // Carried through so the UI can link N° pièce to the actual ticket this
    // line was produced by — see CaisseClient.jsx. transaction.id and
    // payment.id are already present on the raw Prisma object (the query
    // above `include`s payment rather than `select`ing it), so this is a
    // free reshape, not a new query.
    transactionId: transaction.id,
    paymentId: transaction.payment?.id ?? null,
    orderId: transaction.payment?.order?.id ?? null,
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

function movementToRow(movement) {
  const amount = Number(movement.amount);
  return {
    kind: movement.type,
    date: movement.occurredAt,
    pieceNumber: movement.pieceNumber,
    reference: null,
    label: movement.label,
    entree: movement.type === "CASH_IN" ? amount : 0,
    sortie: movement.type === "CASH_IN" ? 0 : amount,
  };
}
