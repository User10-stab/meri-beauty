-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "stripeCheckoutSessionId" TEXT,
ADD COLUMN     "stripePaymentIntentId" TEXT;
