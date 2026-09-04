-- AlterTable: Add soft-delete fields to Category, Service, and StaffService

ALTER TABLE "Category" ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Category" ADD COLUMN "deletedAt" TIMESTAMP(3);

ALTER TABLE "Service" ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Service" ADD COLUMN "deletedAt" TIMESTAMP(3);

ALTER TABLE "StaffService" ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StaffService" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- CreateIndex: Indexes for soft-delete filters
CREATE INDEX "Category_isDeleted_idx" ON "Category"("isDeleted");

CREATE INDEX "Service_categoryId_isDeleted_idx" ON "Service"("categoryId", "isDeleted");

CREATE INDEX "StaffService_serviceId_isDeleted_idx" ON "StaffService"("serviceId", "isDeleted");

CREATE INDEX "StaffService_staffId_isDeleted_idx" ON "StaffService"("staffId", "isDeleted");
