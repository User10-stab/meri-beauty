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

// ─── Contract expiry check ────────────────────────────────────────────────────
//
// Called from two places in this file:
//   1. authorize()  — login-time gate, so an expired staff member can't sign
//      in even before the periodic JWT revalidation has had a chance to run.
//   2. jwt()        — periodic revalidation gate (every SESSION_REVALIDATE_
//      INTERVAL_MS), so an already-logged-in staff member whose contract
//      expires mid-session is kicked out on their next authenticated request.
//
// When expiry is detected this function:
//   • Marks the contract EXPIRED
//   • Sets Staff.isActive = false
//   • Sets User.isActive  = false
//   • Bumps User.sessionVersion  ← makes every other live JWT for this user
//     invalid immediately (the jwt() callback compares token.sessionVersion
//     with the DB value and returns null on mismatch)
//
// Returns true if the contract was found to be expired (and mutations were
// applied), false if the staff is fine and should be allowed through.
//
// IMPORTANT: does NOT touch StaffService rows or appointments.

async function checkAndExpireStaffContract(userId) {
  const staff = await prisma.staff.findUnique({
    where: { userId },
    select: {
      id: true,
      contracts: {
        where: { status: "ACTIVE" },
        select: { id: true, startDate: true, endDate: true },
        take: 1,
      },
    },
  });

  // No staff profile at all — nothing to expire; let the existing
  // isActive/isDeleted guards handle it.
  if (!staff) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const activeContract = staff.contracts[0] ?? null;

  // A staff member with no ACTIVE contract is already blocked by
  // isStaffAvailable() in the booking flow and by the onboarding guard in
  // the authorized() callback above.  We don't expire what isn't active.
  if (!activeContract) return false;

  const contractStart = new Date(activeContract.startDate);
  contractStart.setHours(0, 0, 0, 0);

  // Contract hasn't started yet — not expired, just pending.
  if (today < contractStart) return false;

  // endDate null means open-ended — never expires.
  if (!activeContract.endDate) return false;

  const contractEnd = new Date(activeContract.endDate);
  contractEnd.setHours(23, 59, 59, 999);

  // Contract end date is in the future (or today) — still valid.
  if (today <= contractEnd) return false;

  // ── Contract is expired — apply all mutations in one transaction ──────────
  // sessionVersion is incremented so every concurrent JWT for this user
  // (other open tabs, mobile browsers, etc.) is also invalidated on their
  // next authenticated request without any additional work.
  await prisma.$transaction([
    prisma.contract.update({
      where: { id: activeContract.id },
      data:  { status: "EXPIRED" },
    }),
    prisma.staff.update({
      where: { id: staff.id },
      data:  { isActive: false },
    }),
    prisma.user.update({
      where: { id: userId },
      data:  { isActive: false, sessionVersion: { increment: 1 } },
    }),
  ]);

  return true;
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
            fullName: true,
            phone: true,
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

        // ── Login-time contract check for staff ─────────────────────────────
        // The periodic jwt() revalidation only fires after the first request
        // post-login, so without this check an expired staff member could
        // complete the login and hold a valid JWT until the next revalidation
        // window. Blocking here is the earliest possible gate.
        if (user.role === "STAFF") {
          const expired = await checkAndExpireStaffContract(user.id);
          if (expired) {
            return null;
          }
        }

        // Fetch profile fields needed across the app (reservation form, etc.)
        return {
          id:       user.id,
          email:    user.email,
          role:     user.role,
          isActive: user.isActive,
          sessionVersion: user.sessionVersion,
          fullName: user.fullName ?? "",
          phone:    user.phone    ?? "",
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
        token.id       = user.id;
        token.email    = user.email;
        token.role     = user.role;
        token.isActive = user.isActive;
        token.sessionVersion = user.sessionVersion;
        token.fullName = user.fullName;
        token.phone    = user.phone;
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

      // ── Periodic contract check for staff ───────────────────────────────
      // Runs inside the same revalidation window as the isActive/sessionVersion
      // check above — no extra interval, no extra mechanism.  If the contract
      // has expired, checkAndExpireStaffContract() mutates the DB (marks the
      // contract EXPIRED, flips isActive flags, bumps sessionVersion) and
      // returns true, so we immediately return null here to kill this token.
      // The sessionVersion bump in the DB also ensures any other live JWTs
      // for this user (other tabs, devices) fail their next sessionVersion
      // comparison and are killed without any additional code.
      if (dbUser.role === "STAFF") {
        const expired = await checkAndExpireStaffContract(token.id);
        if (expired) {
          return null;
        }
      }

      token.role = dbUser.role;
      token.isActive = dbUser.isActive;
      token.validatedAt = Date.now();
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id       = token.id;
        session.user.role     = token.role;
        session.user.email    = token.email;
        session.user.isActive = token.isActive;
        session.user.fullName = token.fullName;
        session.user.phone    = token.phone;
      }
      return session;
    },
  },
});
