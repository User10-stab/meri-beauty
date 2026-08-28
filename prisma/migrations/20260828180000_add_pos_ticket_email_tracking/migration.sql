-- Tracks whether a POS walk-in ("client de passage") ticket e-mail was
-- requested and whether it actually succeeded. Until now neither the
-- outcome nor the recipient was persisted anywhere: the cashier's one-shot
-- toast and a Sentry-only error log were the entire trail, so a customer
-- reporting "I never got my ticket" could not be investigated after the
-- fact. posTicketEmailTo set with posTicketEmailSentAt null means the send
-- was attempted and failed.

ALTER TABLE "Order" ADD COLUMN "posTicketEmailTo" TEXT,
ADD COLUMN "posTicketEmailSentAt" TIMESTAMP(3);
