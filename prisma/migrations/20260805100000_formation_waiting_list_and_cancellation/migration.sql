-- AlterTable
ALTER TABLE "formation_reservations" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledByUserId" TEXT;

-- AlterTable
ALTER TABLE "formation_sessions" ADD COLUMN     "lowSeatsNotifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "waiting_list_entries" ADD COLUMN     "formationSessionId" TEXT,
ALTER COLUMN "sessionId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "waiting_list_entries_formationSessionId_position_idx" ON "waiting_list_entries"("formationSessionId", "position");

-- CreateIndex
CREATE INDEX "waiting_list_entries_formationSessionId_status_idx" ON "waiting_list_entries"("formationSessionId", "status");

-- AddForeignKey
ALTER TABLE "waiting_list_entries" ADD CONSTRAINT "waiting_list_entries_formationSessionId_fkey" FOREIGN KEY ("formationSessionId") REFERENCES "formation_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formation_reservations" ADD CONSTRAINT "formation_reservations_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Polymorphic guard: a WaitingListEntry belongs to exactly one of an atelier
-- session or a formation session, same pattern as Payment_exactly_one_source.
ALTER TABLE "waiting_list_entries"
  ADD CONSTRAINT "WaitingListEntry_exactly_one_session"
  CHECK (
    (CASE WHEN "sessionId" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "formationSessionId" IS NOT NULL THEN 1 ELSE 0 END) = 1
  );
