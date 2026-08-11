ALTER TABLE "Newsletter" ADD COLUMN "createdByStaffId" TEXT;

ALTER TABLE "Newsletter" ADD CONSTRAINT "Newsletter_createdByStaffId_fkey"
  FOREIGN KEY ("createdByStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Newsletter_createdByStaffId_idx" ON "Newsletter"("createdByStaffId");
