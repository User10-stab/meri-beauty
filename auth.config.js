/**
 * Edge-safe Auth.js config — safe to import in middleware.
 * Do NOT import Prisma or the Prisma adapter here.
 *
 * @type {import("next-auth").NextAuthConfig}
 */
import { canAccessDashboard, isAdminRole } from "@/lib/authorization";

// Define admin-only route patterns
const ADMIN_ONLY_ROUTES = [
  "/dashboard/staff",
  "/dashboard/categories",
  "/dashboard/rental-requests",
  "/dashboard/reports",
  "/dashboard/salon-settings",
  "/dashboard/settings",
];

/**
 * Check if a pathname matches any admin-only route
 * @param {string} pathname
 * @returns {boolean}
 */
function isAdminOnlyRoute(pathname) {
  return ADMIN_ONLY_ROUTES.some((route) => pathname.startsWith(route));
}

export const authConfig = {
  pages: {
    signIn: "/login",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isDashboardRoute = nextUrl.pathname.startsWith("/dashboard");

      if (isDashboardRoute) {
        // Must be logged in
        if (!isLoggedIn) {
          return false;
        }

        // Must have a role that allows dashboard access
        const userRole = auth?.user?.role;
        if (!canAccessDashboard(userRole)) {
          // Redirect customers to website home page
          return Response.redirect(new URL("/", nextUrl));
        }

        // Check for admin-only routes
        if (isAdminOnlyRoute(nextUrl.pathname)) {
          if (!isAdminRole(userRole)) {
            // Staff trying to access admin page - redirect to dashboard home
            return Response.redirect(new URL("/dashboard", nextUrl));
          }
        }

        return true;
      }

      return true;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.isActive = token.isActive;
      }
      return session;
    },
  },
  providers: [],
};
