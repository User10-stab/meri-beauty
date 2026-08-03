/**
 * Server-side route protection utilities
 * Use these in page components to enforce role-based access control
 */

import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import { isAdminRole, canAccessDashboard } from "@/lib/authorization";

/**
 * Require authentication and dashboard access
 * Redirects to login if not authenticated
 * Redirects to home if user doesn't have dashboard access
 * 
 * @returns {Promise<{ user: Object, session: Object }>}
 */
export async function requireDashboard() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  if (!canAccessDashboard(session.user.role)) {
    redirect("/");
  }

  return { user: session.user, session };
}

/**
 * Require admin role (OWNER or ADMIN)
 * Returns 404 if user is not an admin
 * 
 * @param {boolean} use404 - If true, returns 404 instead of redirecting (default: true)
 * @returns {Promise<{ user: Object, session: Object }>}
 */
export async function requireAdmin(use404 = true) {
  const { user, session } = await requireDashboard();

  if (!isAdminRole(user.role)) {
    if (use404) {
      notFound(); // Returns 404 page
    } else {
      redirect("/dashboard"); // Redirect to dashboard home
    }
  }

  return { user, session };
}

/**
 * Require the current dashboard user's role to be in allowedRoles.
 * Redirects to /dashboard if authenticated but not permitted — unlike
 * requireAdmin's default 404, these are legitimate dashboard sections that
 * just aren't open to this role, not pages that should look nonexistent.
 *
 * @param {string[]} allowedRoles - e.g. DASHBOARD_PERMISSIONS.WORKSHOPS
 * @returns {Promise<{ user: Object, session: Object }>}
 */
export async function requireRole(allowedRoles) {
  const { user, session } = await requireDashboard();

  if (!allowedRoles.includes(user.role)) {
    redirect("/dashboard");
  }

  return { user, session };
}

/**
 * Get current session with dashboard check
 * Throws error if not authenticated or doesn't have dashboard access
 * 
 * @returns {Promise<Object>} - The authenticated session
 */
export async function getDashboardSession() {
  const session = await auth();

  if (!session?.user) {
    throw new Error("Not authenticated");
  }

  if (!canAccessDashboard(session.user.role)) {
    throw new Error("Insufficient permissions");
  }

  return session;
}

/**
 * Check if current user is an admin
 * Does not throw or redirect, just returns boolean
 * 
 * @returns {Promise<boolean>}
 */
export async function isCurrentUserAdmin() {
  const session = await auth();
  return session?.user ? isAdminRole(session.user.role) : false;
}

/**
 * Get the staff ID for the current user if they are staff
 * Returns null if not a staff member or not found
 * 
 * @returns {Promise<string|null>}
 */
export async function getCurrentStaffId() {
  const session = await auth();
  
  if (!session?.user || session.user.role !== "STAFF") {
    return null;
  }

  // Import prisma here to avoid edge runtime issues
  const { prisma } = await import("@/lib/prisma");
  
  const staff = await prisma.staff.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });

  return staff?.id || null;
}
