/**
 * Relationships that make a customer belong to a staff member.
 * Appointments are linked through StaffService; formations are linked to the
 * User account that created the formation.
 */
export function staffCustomerRelationshipFilters({ staffId, staffUserId, marketingEligibleOnly = false }) {
  const appointmentWhere = {
    isDeleted: false,
    staffService: { staffId },
    ...(marketingEligibleOnly
      ? { status: { in: ["CONFIRMED", "COMPLETED"] } }
      : { status: { notIn: ["CANCELLED", "REJECTED"] } }),
  };
  const formationReservationWhere = {
    session: { formation: { createdById: staffUserId } },
    ...(marketingEligibleOnly
      ? { status: { in: ["CONFIRMED", "COMPLETED"] } }
      : { status: { not: "CANCELLED" } }),
  };

  return [
    { appointments: { some: appointmentWhere } },
    { formationReservations: { some: formationReservationWhere } },
  ];
}
