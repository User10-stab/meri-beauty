/**
 * A RefundOperation's status, always derived from its legs.
 *
 * Its own module rather than living beside the Stripe call that first needed
 * it: the two other callers — the charge.refunded webhook and an admin
 * confirming a cash hand-over at the counter — have no business loading the
 * Stripe SDK to recompute a status, and one of them runs in a request that
 * may have no Stripe key configured at all.
 *
 * Derived, never assigned. A caller that "knows" the operation is finished
 * is exactly how a half-settled operation ends up claiming COMPLETED while a
 * cash leg is still sitting on the counter.
 */

/**
 * @param {import("@prisma/client").PrismaClient|import("@prisma/client").Prisma.TransactionClient} prismaOrTx
 * @param {string} operationId
 * @returns {Promise<"COMPLETED"|"PARTIALLY_REFUNDED"|"FAILED"|"PENDING"|null>}
 */
export async function refreshOperationStatus(prismaOrTx, operationId) {
  const legs = await prismaOrTx.refundLeg.findMany({
    where: { refundOperationId: operationId },
    select: { status: true, amount: true, settledAmount: true },
  });
  if (legs.length === 0) return null;

  // A leg counts as done only if the money that came back actually covers
  // what was owed. An admin who types 50 € into Stripe against a 75 € leg
  // has made a real refund — the leg is SUCCEEDED and must stay so, or a
  // redelivered webhook would record that 50 € a second time — but the
  // operation is NOT complete and the customer must not be told it is.
  //
  // Without this the shortfall disappeared: the operation went COMPLETED
  // with 25 € still owed, and the closing e-mail announced the full figure.
  const EPSILON = 0.01;
  const isFullySettled = (leg) =>
    leg.status === "SUCCEEDED" &&
    (leg.settledAmount == null || Number(leg.settledAmount) + EPSILON >= Number(leg.amount));

  const succeeded = legs.filter(isFullySettled).length;
  const partiallySettled = legs.some((leg) => leg.status === "SUCCEEDED") && succeeded < legs.length;
  const failed = legs.filter((leg) => leg.status === "FAILED").length;

  const status =
    succeeded === legs.length ? "COMPLETED"
    : partiallySettled ? "PARTIALLY_REFUNDED"
    // Every outstanding leg errored — retryable, and visible as such rather
    // than indistinguishable from "not started yet".
    : failed === legs.length ? "FAILED"
    : "PENDING";

  await prismaOrTx.refundOperation.update({ where: { id: operationId }, data: { status } });
  return status;
}
