/**
 * Reservation Compliance Helper
 *
 * Computes a "reservation readiness" status for staff, services, and categories
 * based on existing data. This does NOT create additional database fields.
 *
 * A staff member is ready for the reservation system if ALL conditions are met.
 * If any condition fails, warnings explain what is missing.
 *
 * Designed for future extensibility — new rules can be added by
 * appending to the check functions.
 *
 * All display messages are in French.
 */

/**
 * Check a single staff member's reservation readiness.
 *
 * Works with the serialised format from getIndependentStaff().
 *
 * @param {object} staff - Staff object with fields: workingHoursCount, servicesCount, user, contract, isActive
 * @returns {{ ready: boolean, warnings: string[] }}
 */
export function checkStaffReservationReadiness(staff) {
  const warnings = [];

  if (!staff) {
    return { ready: false, warnings: ["Données du professionnel introuvables."] };
  }

  // ── 1. Staff is active ────────────────────────────────────────────
  if (!staff.isActive) {
    warnings.push("Le professionnel est marqué comme inactif.");
  }

  // ── 2. Linked user account is active and not deleted ───────────────
  if (staff.userIsDeleted) {
    warnings.push("Le compte utilisateur lié est supprimé.");
  } else if (!staff.userIsActive) {
    warnings.push("Le compte utilisateur lié est inactif.");
  }

  // ── 3. Has at least one active service assigned ───────────────────
  if (staff.servicesCount === 0) {
    warnings.push("Aucun service n'est assigné à ce professionnel.");
  }

  // ── 4. Has at least one WorkingHour ───────────────────────────────
  if (staff.workingHoursCount === 0) {
    warnings.push("Aucun horaire de travail n'a été configuré.");
  }

  // ── 5. Has an ACTIVE contract ────────────────────────────────────
  const contract = staff.contract;
  if (!contract) {
    warnings.push("Aucun contrat actif trouvé.");
  } else if (contract.status !== "ACTIVE") {
    warnings.push("Le contrat n'est pas actif (statut : " + contract.status + ").");
  } else {
    // ── 6. Contract start date has been reached ──────────────────────
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const contractStart = new Date(contract.startDate);
    contractStart.setHours(0, 0, 0, 0);
    if (today < contractStart) {
      warnings.push("Le contrat n'a pas encore commencé (débute le " + contractStart.toLocaleDateString("fr-FR") + ").");
    }

    // ── 7. Contract has not expired ──────────────────────────────────
    if (contract.endDate) {
      const contractEnd = new Date(contract.endDate);
      contractEnd.setHours(23, 59, 59, 999);
      if (today > contractEnd) {
        warnings.push("Le contrat a expiré (terminé le " + new Date(contract.endDate).toLocaleDateString("fr-FR") + ").");
      }
    }
  }

  return {
    ready: warnings.length === 0,
    warnings,
  };
}

/**
 * Check a single service's reservation readiness.
 *
 * @param {object} service - Service object with staffServices array
 * @returns {{ ready: boolean, warnings: string[] }}
 */
export function checkServiceReservationReadiness(service) {
  const warnings = [];

  if (!service) {
    return { ready: false, warnings: ["Données du service introuvables."] };
  }

  const staffServices = service.staffServices || [];

  if (staffServices.length === 0) {
    warnings.push("Aucun professionnel assigné. Ce service n'apparaîtra pas sur la page de réservation tant qu'au moins un professionnel ne lui sera pas assigné.");
  }

  return {
    ready: warnings.length === 0,
    warnings,
  };
}

/**
 * Check a single category's reservation readiness.
 *
 * @param {object} category - Category object with services array.
 *   Each service should have staffServicesCount to determine if bookable.
 * @returns {{ ready: boolean, warnings: string[] }}
 */
export function checkCategoryReservationReadiness(category) {
  const warnings = [];

  if (!category) {
    return { ready: false, warnings: ["Données de la catégorie introuvables."] };
  }

  const services = category.services || [];

  if (services.length === 0) {
    warnings.push("Cette catégorie n'a aucun service. Elle n'apparaîtra pas sur la page de réservation.");
    return { ready: false, warnings };
  }

  // Check if any service has at least one staff assigned
  const hasStaffAssigned = services.some(
    (s) => (s.staffServicesCount || (s.staffServices || []).length) > 0
  );

  if (!hasStaffAssigned) {
    warnings.push("Aucun service dans cette catégorie n'a de professionnel assigné. Cette catégorie n'apparaîtra pas sur la page de réservation.");
  }

  return {
    ready: warnings.length === 0,
    warnings,
  };
}

/**
 * Get a summary of reservation readiness for all staff members.
 *
 * @param {Array<object>} staffList - Array of staff objects
 * @returns {Map<string, { ready: boolean, warnings: string[] }>} - Map keyed by staff id
 */
export function getStaffReadinessMap(staffList) {
  const map = new Map();
  if (!staffList || !Array.isArray(staffList)) return map;

  for (const staff of staffList) {
    map.set(staff.id, checkStaffReservationReadiness(staff));
  }

  return map;
}

/**
 * Get a summary of reservation readiness for all services.
 *
 * @param {Array<object>} services - Array of service objects
 * @returns {Map<string, { ready: boolean, warnings: string[] }>} - Map keyed by service id
 */
export function getServiceReadinessMap(services) {
  const map = new Map();
  if (!services || !Array.isArray(services)) return map;

  for (const service of services) {
    map.set(service.id, checkServiceReservationReadiness(service));
  }

  return map;
}

/**
 * Get a summary of reservation readiness for all categories.
 *
 * @param {Array<object>} categories - Array of category objects with nested services and staffServices/staffServicesCount
 * @returns {Map<string, { ready: boolean, warnings: string[] }>} - Map keyed by category id
 */
export function getCategoryReadinessMap(categories) {
  const map = new Map();
  if (!categories || !Array.isArray(categories)) return map;

  for (const category of categories) {
    map.set(category.id, checkCategoryReservationReadiness(category));
  }

  return map;
}