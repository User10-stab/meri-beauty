-- Appointment has ~15 query sites (conflict checks, calendar loads,
-- available-slots, "my appointments", dashboard filters) and had zero
-- indexes, forcing a full table scan on every one of them.
CREATE INDEX "Appointment_staffServiceId_startTime_idx" ON "Appointment"("staffServiceId", "startTime");

-- CreateIndex
CREATE INDEX "Appointment_userId_startTime_idx" ON "Appointment"("userId", "startTime");

-- CreateIndex
CREATE INDEX "Appointment_isDeleted_status_startTime_idx" ON "Appointment"("isDeleted", "status", "startTime");

-- expireStaleOrders (actions/boutique/orders.js) filters expiresAt < now on
-- every cron tick with no index; fulfilmentMode is filtered by several
-- dashboard queries.
CREATE INDEX "Order_expiresAt_idx" ON "Order"("expiresAt");

-- CreateIndex
CREATE INDEX "Order_fulfilmentMode_idx" ON "Order"("fulfilmentMode");
