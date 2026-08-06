import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "./auth.config";

const COOKIE_NAME = "meri_site_access";
const GATE_PASSWORD = process.env.SITE_ACCESS_PASSWORD;

async function sha256Hex(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default async function middleware(request) {
  const gateEnabled = !!GATE_PASSWORD;

  if (gateEnabled) {
    const { pathname } = request.nextUrl;
    const expected = await sha256Hex(GATE_PASSWORD);
    const unlocked = request.cookies.get(COOKIE_NAME)?.value === expected;

    if (pathname === "/acces") {
      // Already unlocked — go straight to the site.
      if (unlocked) {
        const url = request.nextUrl.clone();
        url.pathname = "/";
        url.search = "";
        return NextResponse.redirect(url);
      }
    } else if (!unlocked) {
      // Locked — send everyone to the gate page.
      return NextResponse.redirect(new URL("/acces", request.url));
    }
  }

  return NextAuth(authConfig).auth(request);
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
