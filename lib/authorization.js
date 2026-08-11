/**
 * Centralized Role-Based Access Control (RBAC) utility
 * 
 * This module provides all authorization logic for the application.
 * All role checks and permissions should be defined here to avoid duplication.
 */

// ─── Role Constants ─────────────────────────────────────────────────────────────

export const ROLES = {
  ADMIN: "ADMIN",
  OWNER: "OWNER",
  STAFF: "STAFF",
  CUSTOMER: "CUSTOMER",
};

// ─── Role Collections ───────────────────────────────────────────────────────────

/**
 * Roles that can access the dashboard
 */
export const DASHBOARD_ROLES = [ROLES.ADMIN, ROLES.OWNER, ROLES.STAFF];

/**
 * Roles that can access the website (customer-facing)
 */
export const WEBSITE_ROLES = [ROLES.CUSTOMER];

/**
 * All valid roles in the system
 */
export const ALL_ROLES = Object.values(ROLES);

// ─── Validation Functions ───────────────────────────────────────────────────────

/**
 * Check if a role is valid
 * @param {string} role - The role to check
 * @returns {boolean}
 */
export function isValidRole(role) {
  return ALL_ROLES.includes(role);
}

/**
 * Check if a role can access the dashboard
 * @param {string} role - The role to check
 * @returns {boolean}
 */
export function canAccessDashboard(role) {
  return DASHBOARD_ROLES.includes(role);
}

/**
 * Check if a role can access the website
 * @param {string} role - The role to check
 * @returns {boolean}
 */
export function canAccessWebsite(role) {
  return WEBSITE_ROLES.includes(role);
}

/**
 * Check if a role is an admin
 * @param {string} role - The role to check
 * @returns {boolean}
 */
export function isAdmin(role) {
  return role === ROLES.ADMIN;
}

/**
 * Check if a role is an owner
 * @param {string} role - The role to check
 * @returns {boolean}
 */
export function isOwner(role) {
  return role === ROLES.OWNER;
}

/**
 * Check if a role is staff
 * @param {string} role - The role to check
 * @returns {boolean}
 */
export function isStaff(role) {
  return role === ROLES.STAFF;
}

/**
 * Check if a role is a customer
 * @param {string} role - The role to check
 * @returns {boolean}
 */
export function isCustomer(role) {
  return role === ROLES.CUSTOMER;
}

/**
 * Check if a role is admin or owner (has administrative privileges)
 * @param {string} role - The role to check
 * @returns {boolean}
 */
export function isAdminRole(role) {
  return role === ROLES.ADMIN || role === ROLES.OWNER;
}

// ─── Authorization Error Messages (French) ──────────────────────────────────────

export const AUTH_ERRORS = {
  /**
   * Error when a CUSTOMER tries to access dashboard
   */
  CUSTOMER_DASHBOARD_ACCESS: 
    "Les clients n'ont pas accès au tableau de bord. Veuillez vous connecter via le site web.",

  /**
   * Error when ADMIN/OWNER/STAFF tries to access website login
   */
  STAFF_WEBSITE_ACCESS: 
    "Les administrateurs, propriétaires et membres du staff doivent se connecter via le tableau de bord.",

  /**
   * Error when user is not authenticated
   */
  NOT_AUTHENTICATED: 
    "Authentification requise. Veuillez vous connecter.",

  /**
   * Error when user doesn't have permission for an action
   */
  INSUFFICIENT_PERMISSIONS: 
    "Vous n'avez pas les permissions nécessaires pour effectuer cette action.",
};

// ─── Session Validation ────────────────────────────────────────────────────────

/**
 * Validate that a user session exists and has a valid role
 * @param {Object} session - The session object from NextAuth
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateSession(session) {
  if (!session?.user) {
    return { valid: false, error: AUTH_ERRORS.NOT_AUTHENTICATED };
  }

  if (!session.user.role) {
    return { valid: false, error: AUTH_ERRORS.NOT_AUTHENTICATED };
  }

  if (!isValidRole(session.user.role)) {
    return { valid: false, error: AUTH_ERRORS.NOT_AUTHENTICATED };
  }

  return { valid: true };
}

/**
 * Validate that a user can access the dashboard
 * @param {Object} session - The session object from NextAuth
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateDashboardAccess(session) {
  const sessionValidation = validateSession(session);
  if (!sessionValidation.valid) {
    return sessionValidation;
  }

  if (!canAccessDashboard(session.user.role)) {
    return { valid: false, error: AUTH_ERRORS.CUSTOMER_DASHBOARD_ACCESS };
  }

  return { valid: true };
}

/**
 * Validate that a user can access the website
 * @param {Object} session - The session object from NextAuth
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateWebsiteAccess(session) {
  const sessionValidation = validateSession(session);
  if (!sessionValidation.valid) {
    return sessionValidation;
  }

  if (!canAccessWebsite(session.user.role)) {
    return { valid: false, error: AUTH_ERRORS.STAFF_WEBSITE_ACCESS };
  }

  return { valid: true };
}

// ─── API Authorization Helpers ───────────────────────────────────────────────────

/**
 * Check if the current session is authorized for dashboard API access
 * Returns an error response if not authorized, null if authorized
 * 
 * @param {Object} session - The session object from NextAuth
 * @param {Function} unauthorized - The unauthorized response function from api-response.js
 * @param {Function} forbidden - The forbidden response function from api-response.js
 * @returns {Response|null}
 */
export function requireDashboardAuth(session, unauthorized, forbidden) {
  if (!session?.user) {
    return unauthorized(AUTH_ERRORS.NOT_AUTHENTICATED);
  }

  if (!canAccessDashboard(session.user.role)) {
    return forbidden(AUTH_ERRORS.CUSTOMER_DASHBOARD_ACCESS);
  }

  return null;
}

/**
 * Check if the current session has a specific role
 * Returns an error response if not authorized, null if authorized
 * 
 * @param {Object} session - The session object from NextAuth
 * @param {string|string[]} allowedRoles - Single role or array of allowed roles
 * @param {Function} unauthorized - The unauthorized response function from api-response.js
 * @param {Function} forbidden - The forbidden response function from api-response.js
 * @returns {Response|null}
 */
export function requireRole(session, allowedRoles, unauthorized, forbidden) {
  if (!session?.user) {
    return unauthorized(AUTH_ERRORS.NOT_AUTHENTICATED);
  }

  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  
  if (!roles.includes(session.user.role)) {
    return forbidden(AUTH_ERRORS.INSUFFICIENT_PERMISSIONS);
  }

  return null;
}

/**
 * Check if the current session is a customer (for customer-only actions like rental requests)
 * Returns an error response if not authorized, null if authorized
 * 
 * @param {Object} session - The session object from NextAuth
 * @param {Function} unauthorized - The unauthorized response function from api-response.js
 * @param {Function} forbidden - The forbidden response function from api-response.js
 * @returns {Response|null}
 */
export function requireCustomer(session, unauthorized, forbidden) {
  if (!session?.user) {
    return unauthorized(AUTH_ERRORS.NOT_AUTHENTICATED);
  }

  if (session.user.role !== ROLES.CUSTOMER) {
    return forbidden("Seuls les clients peuvent soumettre des demandes de location.");
  }

  return null;
}

// ─── Dashboard Permissions ──────────────────────────────────────────────────────

/**
 * Navigation/route permissions for dashboard users
 */
export const DASHBOARD_PERMISSIONS = {
  // Pages accessible to all dashboard users
  DASHBOARD_HOME: [ROLES.OWNER, ROLES.ADMIN, ROLES.STAFF],
  APPOINTMENTS: [ROLES.OWNER, ROLES.ADMIN, ROLES.STAFF],
  CUSTOMERS: [ROLES.OWNER, ROLES.ADMIN, ROLES.STAFF],
  SERVICES: [ROLES.OWNER, ROLES.ADMIN, ROLES.STAFF],
  CATEGORIES: [ROLES.OWNER, ROLES.ADMIN],

  // Admin-only pages
  STAFF_MANAGEMENT: [ROLES.OWNER, ROLES.ADMIN],
  RENTAL_REQUESTS: [ROLES.OWNER, ROLES.ADMIN],
  // STAFF can author/send too (client decision, 10 Aug 2026) — see the
  // Newsletter.createdByStaffId comment in schema.prisma for the ownership
  // rule that goes with this (STAFF acts on their own drafts only).
  NEWSLETTER: [ROLES.OWNER, ROLES.ADMIN, ROLES.STAFF],
  REPORTS: [ROLES.OWNER, ROLES.ADMIN],
  SALON_SETTINGS: [ROLES.OWNER, ROLES.ADMIN],
  REVIEWS: [ROLES.OWNER, ROLES.ADMIN],

  // Boutique catalogue CRUD (brand/category/subcategory management, product
  // create/edit/delete, Wix importer) — admin-only, per the client's
  // confirmed split: staff can view the catalogue and adjust stock, but not
  // restructure it or touch cost/margin data.
  BOUTIQUE: [ROLES.OWNER, ROLES.ADMIN],

  // Stock adjustments + read-only catalogue browsing — day-to-day counter
  // work a STAFF member needs (check what's in stock, count/adjust it, look
  // up a product), unlike BOUTIQUE's structural CRUD. getProducts() itself
  // omits cost/margin fields for non-admin callers regardless of this gate,
  // so even the products list view never leaks financial data to STAFF.
  BOUTIQUE_STOCK: [ROLES.OWNER, ROLES.ADMIN, ROLES.STAFF],

  // Orders — day-to-day counter work (pickup QR scan, tracking entry),
  // unlike catalogue management. Staff need this even while BOUTIQUE stays
  // admin-only.
  ORDERS: [ROLES.OWNER, ROLES.ADMIN, ROLES.STAFF],

  // Invoices/credit notes — accounting records, admin-only. Staff can still
  // download the PDF for one specific order/appointment they're handling
  // (gated separately by ORDERS/APPOINTMENTS), just not browse the full ledger.
  INVOICES: [ROLES.OWNER, ROLES.ADMIN],

  // Promo codes — spans all four purchase flows (boutique, ateliers,
  // formations, appointments), admin-only since they directly affect revenue.
  PROMO_CODES: [ROLES.OWNER, ROLES.ADMIN],

  // Workshops/events — who can reach the Activités/Animateurs pages at all.
  // A flat role gate; ownership (which activities a STAFF may edit/delete)
  // is a separate, per-row check — see requireActivityAccess() in
  // actions/workshops/create-activity.js.
  WORKSHOPS: [ROLES.OWNER, ROLES.ADMIN, ROLES.STAFF],

  // Workshop reservations/waiting list — viewing is flat (both roles see
  // every atelier's reservations); deleting/editing a reservation is
  // admin-only, enforced inside the action itself, not via a role list,
  // since STAFF can view but not mutate within this same permission.
  WORKSHOP_RESERVATIONS: [ROLES.OWNER, ROLES.ADMIN, ROLES.STAFF],

  // Formations (training courses) — same pattern as WORKSHOPS: a flat role
  // gate on reaching the page at all, with per-row ownership (staff can
  // only edit/delete formations they created) checked separately inside
  // actions/formations/create-formation.js.
  FORMATIONS: [ROLES.OWNER, ROLES.ADMIN, ROLES.STAFF],

  // Formation reservations — flat view for both roles, same as
  // WORKSHOP_RESERVATIONS.
  FORMATION_RESERVATIONS: [ROLES.OWNER, ROLES.ADMIN, ROLES.STAFF],

  // Webhook/refund reconciliation dashboard — surfaces Payments stuck in
  // REFUND_PENDING/REFUND_FAILED with a manual retry action. Admin-only,
  // same rationale as INVOICES: it's a financial ledger view, not
  // day-to-day counter work.
  PAYMENT_RECONCILIATION: [ROLES.OWNER, ROLES.ADMIN],
};

/**
 * Check if a user has permission to access a specific dashboard feature
 * @param {string} userRole - The user's role
 * @param {string[]} allowedRoles - Array of roles allowed to access the feature
 * @returns {boolean}
 */
export function hasPermission(userRole, allowedRoles) {
  return allowedRoles.includes(userRole);
}

/**
 * Check if a user can access admin-only features
 * @param {string} role - The user's role
 * @returns {boolean}
 */
export function canAccessAdminFeatures(role) {
  return isAdminRole(role);
}

/**
 * Get the user's staff ID if they are a staff member
 * Used for data filtering in server actions
 * @param {Object} session - The session object from NextAuth
 * @returns {Promise<string|null>} - Staff ID or null if not a staff member
 */
export async function getStaffId(session) {
  if (!session?.user || session.user.role !== ROLES.STAFF) {
    return null;
  }

  // Import prisma here to avoid circular dependencies
  const { prisma } = await import("@/lib/prisma");
  
  const staff = await prisma.staff.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });

  return staff?.id || null;
}
