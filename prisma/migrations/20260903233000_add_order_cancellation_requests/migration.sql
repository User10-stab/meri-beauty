-- Customer cancellation requests for already-paid product orders. A request
-- records intent only; the order is cancelled later, after an administrator
-- approves it through the application workflow.
CREATE TYPE "OrderCancellationRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TYPE "NotificationType" ADD VALUE 'ORDER_CANCELLATION_REQUEST';

CREATE TABLE "OrderCancellationRequest" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "OrderCancellationRequestStatus" NOT NULL DEFAULT 'PENDING',
  "reviewedAt" TIMESTAMP(3),
  "reviewedByUserId" TEXT,
  "decisionNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrderCancellationRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderCancellationRequest_orderId_key" ON "OrderCancellationRequest"("orderId");
CREATE INDEX "OrderCancellationRequest_status_createdAt_idx" ON "OrderCancellationRequest"("status", "createdAt");
CREATE INDEX "OrderCancellationRequest_requestedByUserId_idx" ON "OrderCancellationRequest"("requestedByUserId");
CREATE INDEX "OrderCancellationRequest_reviewedByUserId_idx" ON "OrderCancellationRequest"("reviewedByUserId");

ALTER TABLE "OrderCancellationRequest"
  ADD CONSTRAINT "OrderCancellationRequest_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderCancellationRequest"
  ADD CONSTRAINT "OrderCancellationRequest_requestedByUserId_fkey"
  FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderCancellationRequest"
  ADD CONSTRAINT "OrderCancellationRequest_reviewedByUserId_fkey"
  FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
