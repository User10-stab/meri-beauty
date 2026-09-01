import { roundMoney } from "@/lib/tax-policy";

/**
 * Assembles one till session's "livre de caisse": the opening float, every
 * CASH transaction attached to the session, and every drawer movement,
 * merged into one chronological ledger with a running balance.
 *
 * Deliberately scoped to CASH only — mixing in CARD/ONLINE rows would make
 * the running "Solde" column meaningless, since those never touched this
 * drawer. Ateliers/événements/formations/rendez-vous all appear here
 * exactly when they were paid in cash; a card sale is still recorded (see
 * Transaction), just not in this drawer's own book.
 *
 * A closed session's opening float already equals the previous session's
 * countedCash (see the auto-carry-forward in openCashSession's caller), so
 * rendering one session at a time already reads as one continuous ledger
 * across days — there is no need to stitch sessions together here.
 *
 * Kept out of any "use server" module so it can be unit-tested against a
 * plain mocked client instead of a real database — see
 * actions/dashboard/cash-book.js for the auth-gated wrapper.
 */
export async function buildCashBookLedger(client, sessionId) {
  const session = await client.cashSession.findUnique({ where: { id: sessionId } });
  if (!session) return null;

  const [transactions, movements] = await Promise.all([
    client.transaction.findMany({
      // A sale whose Payment already carries a legal Invoice is tracked
      // through that Invoice's own record and the Opérations page —
      // deliberately excluded here (rows and totals both) so the same
      // money is never represented twice. Deliberate tradeoff, accepted by
      // the salon: cash actually in the drawer from an invoiced sale no
      // longer contributes to this ledger's own balance.
      where: { cashSessionId: sessionId, method: "CASH", isDeleted: false, pieceNumber: { not: null }, payment: { invoice: null } },
      include: {
        payment: {
          include: {
            invoice: { select: { number: true } },
            order: { select: { orderNumber: true } },
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
    }),
    client.cashMovement.findMany({
      where: { cashSessionId: sessionId },
      include: { recordedBy: { select: { fullName: true } } },
      orderBy: { occurredAt: "asc" },
    }),
  ]);

  const rows = [
    {
      kind: "OPENING",
      date: session.openedAt,
      pieceNumber: null,
      reference: null,
      label: "Solde initial",
      entree: Number(session.openingFloat),
      sortie: 0,
    },
    ...transactions.map(transactionToRow),
    ...movements.map(movementToRow),
  ];

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

  let balance = 0;
  const withBalance = rows.map((row) => {
    balance = roundMoney(balance + row.entree - row.sortie);
    return { ...row, solde: balance };
  });

  // Excludes the OPENING row: the float is the ledger's starting point, not
  // a transaction of the day, exactly as CashSession.expectedCash treats
  // openingFloat separately from cashIn/cashOut. Including it here would
  // make "Total entrées" disagree with the till-close reconciliation for
  // the same session.
  const totals = withBalance.reduce(
    (acc, row) => {
      if (row.kind === "OPENING") return acc;
      return { entrees: roundMoney(acc.entrees + row.entree), sorties: roundMoney(acc.sorties + row.sortie) };
    },
    { entrees: 0, sorties: 0 }
  );

  return {
    session: {
      id: session.id,
      openedAt: session.openedAt,
      closedAt: session.closedAt,
      openingFloat: Number(session.openingFloat),
    },
    rows: withBalance,
    totals: { ...totals, finalBalance: balance },
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
