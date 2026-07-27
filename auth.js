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

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email?.trim().toLowerCase();
        const password = credentials?.password;

        if (!email || !password) {
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

        const passwordMatch = await bcrypt.compare(password, user.password);

        if (!passwordMatch) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          role: user.role,
          isActive: user.isActive,
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
      }
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
