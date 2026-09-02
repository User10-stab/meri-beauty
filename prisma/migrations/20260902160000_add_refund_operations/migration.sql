-- CreateEnum
CREATE TYPE "RefundOperationSource" AS ENUM ('APPOINTMENT', 'WORKSHOP', 'FORMATION', 'ORDER', 'POS');

-- CreateEnum
CREATE TYPE "RefundTrigger" AS ENUM ('CUSTOMER_REQUEST_APPROVED', 'SALON_CANCELLATION', 'NO_SHOW_EXCEPTION', 'SHOP_RETURN');

-- CreateEnum
CREATE TYPE "RefundOperationStatus" AS ENUM ('PENDING', 'PARTIALLY_REFUNDED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "RefundLegStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'MANUAL_CONFIRMATION_REQUIRED');

-- DropIndex
DROP INDEX "Transaction_creditNoteId_key";

-- CreateTable
CREATE TABLE "RefundOperation" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "source" "RefundOperationSource" NOT NULL,
    "trigger" "RefundTrigger" NOT NULL,
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "creditNoteId" TEXT,
    "refundReceiptNumber" TEXT,
    "decidedByUserId" TEXT,
    "status" "RefundOperationStatus" NOT NULL DEFAULT 'PENDING',
    "itemCancelledAt" TIMESTAMP(3),
    "customerNotifiedAt" TIMESTAMP(3),
    "appointmentCancellationRequestId" TEXT,
    "reservationCancellationRequestId" TEXT,
    "returnRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefundOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundLeg" (
    "id" TEXT NOT NULL,
    "refundOperationId" TEXT NOT NULL,
    "sourceTransactionId" TEXT,
    "method" "TransactionMethod" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" "RefundLegStatus" NOT NULL DEFAULT 'PENDING',
    "stripeIdempotencyKey" TEXT,
    "stripeRefundId" TEXT,
    "stripePaymentIntentId" TEXT,
    "terminalReference" TEXT,
    "cashHandedOver" BOOLEAN NOT NULL DEFAULT false,
    "cashSessionId" TEXT,
    "pieceNumber" TEXT,
    "confirmedByUserId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "refundTransactionId" TEXT,
    "failureReason" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefundLeg_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RefundOperation_creditNoteId_key" ON "RefundOperation"("creditNoteId");

-- CreateIndex
CREATE UNIQUE INDEX "RefundOperation_refundReceiptNumber_key" ON "RefundOperation"("refundReceiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "RefundOperation_appointmentCancellationRequestId_key" ON "RefundOperation"("appointmentCancellationRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "RefundOperation_reservationCancellationRequestId_key" ON "RefundOperation"("reservationCancellationRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "RefundOperation_returnRequestId_key" ON "RefundOperation"("returnRequestId");

-- CreateIndex
CREATE INDEX "RefundOperation_paymentId_status_idx" ON "RefundOperation"("paymentId", "status");

-- CreateIndex
CREATE INDEX "RefundOperation_status_createdAt_idx" ON "RefundOperation"("status", "createdAt");

-- CreateIndex
CREATE INDEX "RefundOperation_decidedByUserId_idx" ON "RefundOperation"("decidedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "RefundLeg_stripeIdempotencyKey_key" ON "RefundLeg"("stripeIdempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "RefundLeg_pieceNumber_key" ON "RefundLeg"("pieceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "RefundLeg_refundTransactionId_key" ON "RefundLeg"("refundTransactionId");

-- CreateIndex
CREATE INDEX "RefundLeg_refundOperationId_idx" ON "RefundLeg"("refundOperationId");

-- CreateIndex
CREATE INDEX "RefundLeg_status_method_idx" ON "RefundLeg"("status", "method");

-- CreateIndex
CREATE INDEX "RefundLeg_sourceTransactionId_idx" ON "RefundLeg"("sourceTransactionId");

-- CreateIndex
CREATE INDEX "RefundLeg_cashSessionId_idx" ON "RefundLeg"("cashSessionId");

-- CreateIndex
CREATE INDEX "Transaction_creditNoteId_idx" ON "Transaction"("creditNoteId");

-- AddForeignKey
ALTER TABLE "RefundOperation" ADD CONSTRAINT "RefundOperation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundOperation" ADD CONSTRAINT "RefundOperation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundOperation" ADD CONSTRAINT "RefundOperation_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "CreditNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundOperation" ADD CONSTRAINT "RefundOperation_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundOperation" ADD CONSTRAINT "RefundOperation_appointmentCancellationRequestId_fkey" FOREIGN KEY ("appointmentCancellationRequestId") REFERENCES "AppointmentCancellationRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundOperation" ADD CONSTRAINT "RefundOperation_reservationCancellationRequestId_fkey" FOREIGN KEY ("reservationCancellationRequestId") REFERENCES "ReservationCancellationRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundOperation" ADD CONSTRAINT "RefundOperation_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundLeg" ADD CONSTRAINT "RefundLeg_refundOperationId_fkey" FOREIGN KEY ("refundOperationId") REFERENCES "RefundOperation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundLeg" ADD CONSTRAINT "RefundLeg_sourceTransactionId_fkey" FOREIGN KEY ("sourceTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundLeg" ADD CONSTRAINT "RefundLeg_cashSessionId_fkey" FOREIGN KEY ("cashSessionId") REFERENCES "CashSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundLeg" ADD CONSTRAINT "RefundLeg_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundLeg" ADD CONSTRAINT "RefundLeg_refundTransactionId_fkey" FOREIGN KEY ("refundTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────
-- At most ONE refund operation in flight per payment.
--
-- Prisma cannot express a partial index, so it is added here by hand. This
-- is the guard that covers the triggers with no request row to key on
-- (SALON_CANCELLATION, NO_SHOW_EXCEPTION): without it, two admins — or one
-- double-click — both pass a read-then-check and both call Stripe.
--
-- Deliberately partial rather than a plain UNIQUE("paymentId"): a FAILED
-- operation must stay on the record beside the retry that later succeeds,
-- and a payment refunded in part today can legitimately be refunded again
-- later. Only the *in-flight* ones are mutually exclusive.
CREATE UNIQUE INDEX "RefundOperation_one_in_flight_per_payment"
  ON "RefundOperation" ("paymentId")
  WHERE "status" IN ('PENDING', 'PARTIALLY_REFUNDED');

-- A leg's money must move exactly once. `refundTransactionId` is already
-- UNIQUE, but this states the other half: no two SUCCEEDED legs may claim
-- the same Stripe refund id (a redelivered webhook settling twice).
CREATE UNIQUE INDEX "RefundLeg_unique_stripe_refund"
  ON "RefundLeg" ("stripeRefundId")
  WHERE "stripeRefundId" IS NOT NULL;
