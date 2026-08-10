-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'REFUND_PENDING';
ALTER TYPE "PaymentStatus" ADD VALUE 'REFUND_FAILED';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "refundFailureReason" TEXT,
ADD COLUMN     "refundAttemptedAt" TIMESTAMP(3),
ADD COLUMN     "refundRetryCount" INTEGER NOT NULL DEFAULT 0;
