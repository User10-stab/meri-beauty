import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcrypt";
import { prisma } from "@/lib/prisma";
import { authConfig } from "./auth.config";
import { ROLES, canAccessDashboard, isAdminRole } from "@/lib/authorization";

async function getStaffOnboardingState(userId) {
  const staff = await prisma.staff.findUnique({
    where: { userId },
    select: {
      id: true,
      setupCompleted: true,
      languages: true,
      contracts: { select: { id: true }, take: 1 },
      workingHours: { select: { id: true }, take: 1 },
    },
  });

  if (!staff) {
    return { isStaff: false, setupCompleted: false };
  }

  const hasLanguages = staff.languages.length > 0;
  const hasContract = staff.contracts.length > 0;
  const hasWorkingHours = staff.workingHours.length > 0;
  const setupCompleted = hasLanguages && hasContract && hasWorkingHours;

  if (setupCompleted && !staff.setupCompleted) {
    await prisma.staff.update({
      where: { id: staff.id },
      data: { setupCompleted: true },
    });
  }

  return { isStaff: true, setupCompleted };
}

// How often the jwt callback re-checks the DB for staleness (password
// changed, account deactivated/deleted) instead of trusting the token as-is.
// A tradeoff between "how fast a revocation takes effect" and "a DB round
// trip on every authenticated request" — 5 minutes is a reasonable middle
// ground for a salon-booking app, not a high-security banking session.
const SESSION_REVALIDATE_INTERVAL_MS = 5 * 60 * 1000;

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  // Shorter than NextAuth's 30-day default — combined with the periodic
  // re-validation below, this bounds how long a stale/stolen session can
  // stay usable even in the worst case (revalidation interval passed but
  // the browser never made a request during that window).
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60 },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        autologinToken: { label: "Autologin Token", type: "text" },
      },
      async authorize(credentials) {
        const email = credentials?.email?.trim().toLowerCase();
        const password = credentials?.password;
        const autologinToken = credentials?.autologinToken;

        if (!email) {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email },
          select: {
            id: true,
            email: true,
            role: true,
            isActive: true,
            isDeleted: true,
            password: true,
            emailVerified: true,
            sessionVersion: true,
          },
        });

        if (!user) {
          return null;
        }

        if (!user.isActive || user.isDeleted) {
          return null;
        }

        if ((user.role === "CUSTOMER" || user.role === "STAFF") && !user.emailVerified) {
          return null;
        }

        if (autologinToken) {
          const { verifyAutologinToken } = await import("@/lib/autologin");
          const isValid = verifyAutologinToken(email, autologinToken);
          if (!isValid) {
            return null;
          }
        } else {
          if (!password) {
            return null;
          }
          const passwordMatch = await bcrypt.compare(password, user.password);
          if (!passwordMatch) {
            return null;
          }
        }

        return {
          id: user.id,
          email: user.email,
          role: user.role,
          isActive: user.isActive,
          sessionVersion: user.sessionVersion,
        };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async authorized({ auth, request: { nextUrl } }) {
      const baseResult = await authConfig.callbacks.authorized({
        auth,
        request: { nextUrl },
      });

      if (baseResult !== true) {
        return baseResult;
      }

      const isDashboardRoute = nextUrl.pathname.startsWith("/dashboard");
      if (!isDashboardRoute) {
        return true;
      }

      const userRole = auth?.user?.role;
      if (userRole !== ROLES.STAFF) {
        return true;
      }

      const accountPath = "/dashboard/account-settings";
      const isAccountRoute = nextUrl.pathname === accountPath || nextUrl.pathname === "/dashboard";

      if (isAccountRoute) {
        return true;
      }

      const onboarding = await getStaffOnboardingState(auth.user.id);
      if (!onboarding.isStaff || !onboarding.setupCompleted) {
        return Response.redirect(new URL(accountPath, nextUrl));
      }

      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.email = user.email;
        token.role = user.role;
        token.isActive = user.isActive;
        token.sessionVersion = user.sessionVersion;
        token.validatedAt = Date.now();
        return token;
      }

      // Not a fresh sign-in — this callback runs on every authenticated
      // request under the JWT strategy. Re-checking the DB every single
      // time would be wasteful, so only do it once the revalidation
      // interval has elapsed since the last check.
      const lastValidated = token.validatedAt ?? 0;
      if (Date.now() - lastValidated < SESSION_REVALIDATE_INTERVAL_MS) {
        return token;
      }

      const dbUser = await prisma.user.findUnique({
        where: { id: token.id },
        select: { isActive: true, isDeleted: true, role: true, sessionVersion: true },
      });

      // Deleted, deactivated, or a password reset (sessionVersion bump)
      // since this token was issued — force sign-out by invalidating it.
      if (!dbUser || dbUser.isDeleted || !dbUser.isActive || dbUser.sessionVersion !== token.sessionVersion) {
        return null;
      }

      token.role = dbUser.role;
      token.isActive = dbUser.isActive;
      token.validatedAt = Date.now();
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.email = token.email;
        session.user.isActive = token.isActive;
      }
      return session;
    },
  },
});
