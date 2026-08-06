import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcrypt";
import { prisma } from "@/lib/prisma";
import { authConfig } from "./auth.config";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  session: { strategy: "jwt" },
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

        // Fetch profile fields needed across the app (reservation form, etc.)
        return {
          id:       user.id,
          email:    user.email,
          role:     user.role,
          isActive: user.isActive,
          fullName: user.fullName ?? "",
          phone:    user.phone    ?? "",
        };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user }) {
      if (user) {
        token.id       = user.id;
        token.email    = user.email;
        token.role     = user.role;
        token.isActive = user.isActive;
        token.fullName = user.fullName;
        token.phone    = user.phone;
      }
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
