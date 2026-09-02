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
    select: { status: true },
  });
  if (legs.length === 0) return null;

  const succeeded = legs.filter((leg) => leg.status === "SUCCEEDED").length;
  const failed = legs.filter((leg) => leg.status === "FAILED").length;

  const status =
    succeeded === legs.length ? "COMPLETED"
    : succeeded > 0 ? "PARTIALLY_REFUNDED"
    // Every outstanding leg errored — retryable, and visible as such rather
    // than indistinguishable from "not started yet".
    : failed === legs.length ? "FAILED"
    : "PENDING";

  await prismaOrTx.refundOperation.update({ where: { id: operationId }, data: { status } });
  return status;
}
