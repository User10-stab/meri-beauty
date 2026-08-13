import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "./auth.config";
import { defaultLocale, isLocale } from "./i18n/routing";

const COOKIE_NAME = "meri_site_access";
const GATE_PASSWORD = process.env.SITE_ACCESS_PASSWORD;

async function sha256Hex(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default async function proxy(request) {
  const existingLocale = request.cookies.get("NEXT_LOCALE")?.value;
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

  const authResponse = await NextAuth(authConfig).auth(request);
  if (!isLocale(existingLocale)) {
    // authResponse can be null when no session modification is needed,
    // but it can also be a plain Response from an auth redirect.
    // NextResponse is the only object that exposes `cookies.set()`.
    const response =
      authResponse instanceof NextResponse
        ? authResponse
        : authResponse
          ? new NextResponse(authResponse.body, authResponse)
          : NextResponse.next();

    response.cookies.set("NEXT_LOCALE", defaultLocale, {
      path: "/",
      maxAge: 31536000,
      sameSite: "lax",
    });
    return response;
  }
  return authResponse;
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff|woff2|ttf|eot|otf)$).*)",
  ],
};
