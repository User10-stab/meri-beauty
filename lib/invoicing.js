/**
 * Invoice / credit-note issuance.
 *
 * Call `issueInvoice`/`issueCreditNote` from INSIDE the same
 * `prisma.$transaction` that settles the payment (or cancels the order) —
 * never standalone. Belgian TVA law requires a truly gapless sequence: the
 * numbering counter is incremented with the document row in one DB
 * transaction, so a rollback (payment race, validation failure, etc.) never
 * burns a number. Never call these outside a transaction.
 */

const VAT_RATE = 21; // single Belgian rate, locked decision

function round2(n) {
  return Math.round(n * 100) / 100;
}

/** Atomic INSERT..ON CONFLICT..RETURNING — safe under concurrent callers. */
async function nextSequenceNumber(tx, series) {
  const year = new Date().getFullYear();
  const key = `${series}-${year}`;
  const rows = await tx.$queryRaw`
    INSERT INTO "NumberingCounter" ("key", "lastNumber") VALUES (${key}, 1)
    ON CONFLICT ("key") DO UPDATE SET "lastNumber" = "NumberingCounter"."lastNumber" + 1
    RETURNING "lastNumber"
  `;
  return { year, seq: Number(rows[0].lastNumber) };
}

/**
 * @param {object} tx - Prisma transaction client
 * @param {{
 *   paymentId: string,
 *   source: "ORDER" | "APPOINTMENT",
 *   totalInclVat: number,
 *   customer: { fullName: string, email: string, vatNumber?: string|null, address?: string|null },
 *   lines: { description: string, quantity: number, unitPrice: number }[],
 * }} input
 */
export async function issueInvoice(tx, { paymentId, source, totalInclVat, customer, lines }) {
  const salon = await tx.salon.findFirst({ select: { name: true, address: true, vatNumber: true } });
  const { year, seq } = await nextSequenceNumber(tx, "invoice");
  const number = `${year}-${String(seq).padStart(6, "0")}`;

  const total = round2(totalInclVat);
  const subtotalExclVat = round2(total / (1 + VAT_RATE / 100));
  const vatAmount = round2(total - subtotalExclVat);

  return tx.invoice.create({
    data: {
      number,
      source,
      paymentId,
      sellerName: salon?.name ?? "Meri Beauty",
      sellerAddress: salon?.address ?? null,
      sellerVatNumber: salon?.vatNumber ?? null,
      customerName: customer.fullName,
      customerEmail: customer.email,
      customerVatNumber: customer.vatNumber ?? null,
      customerAddress: customer.address ?? null,
      subtotalExclVat,
      vatRate: VAT_RATE,
      vatAmount,
      totalInclVat: total,
      lines: {
        create: lines.map((line) => ({
          description: line.description,
          quantity: line.quantity,
          unitPrice: round2(line.unitPrice),
          lineTotal: round2(line.unitPrice * line.quantity),
        })),
      },
    },
    include: { lines: true },
  });
}

/**
 * @param {object} tx - Prisma transaction client
 * @param {{ invoiceId: string, reason?: string|null, totalInclVat: number }} input
 */
export async function issueCreditNote(tx, { invoiceId, reason, totalInclVat }) {
  const amount = round2(totalInclVat);

  // Defense in depth against over-crediting an invoice — the real
  // concurrency guard against double-claiming units lives at each caller
  // (e.g. requestReturn's row lock on the Order), this catches it even if
  // that guard ever slips or a new caller forgets it.
  const invoice = await tx.invoice.findUnique({ where: { id: invoiceId }, select: { totalInclVat: true } });
  if (!invoice) {
    throw new Error("CREDIT_NOTE_INVOICE_NOT_FOUND");
  }
  const { _sum } = await tx.creditNote.aggregate({ where: { invoiceId }, _sum: { totalInclVat: true } });
  const alreadyIssued = Number(_sum.totalInclVat ?? 0);
  const EPSILON = 0.01;
  if (alreadyIssued + amount > Number(invoice.totalInclVat) + EPSILON) {
    throw new Error("CREDIT_NOTE_EXCEEDS_INVOICE");
  }

  const { year, seq } = await nextSequenceNumber(tx, "creditnote");
  const number = `NC${year}-${String(seq).padStart(6, "0")}`;

  return tx.creditNote.create({
    data: {
      number,
      invoiceId,
      reason: reason ?? null,
      totalInclVat: amount,
    },
  });
}
