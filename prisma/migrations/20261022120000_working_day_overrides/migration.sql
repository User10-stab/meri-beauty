-- One-day exceptions to a staff member's weekly working hours (« Définir les
-- horaires de travail »): a usual day blocked, or a day off opened.
CREATE TABLE "WorkingDayOverride" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "isWorking" BOOLEAN NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkingDayOverride_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkingDayOverride_staffId_dateKey_key" ON "WorkingDayOverride"("staffId", "dateKey");

ALTER TABLE "WorkingDayOverride" ADD CONSTRAINT "WorkingDayOverride_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
