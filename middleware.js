import { NextResponse } from "next/server";
import { authConfig } from "./auth.config";
import { decryptToken, defaultCookies } from "./lib/middleware-auth";

function getSessionToken(request, cookieName) {
  const all = [...request.cookies];
  const entries = all
    .filter(([name]) => name === cookieName || name.startsWith(cookieName + "."))
    .sort(([a], [b]) => {
      const aIdx = parseInt(a.split(".").pop() || "0", 10);
      const bIdx = parseInt(b.split(".").pop() || "0", 10);
      return aIdx - bIdx;
    });
  return entries.map(([, v]) => v.value).join("") || null;
}

export default async function middleware(request) {
  const useSecureCookies = request.nextUrl.protocol === "https:";
  const cookieName = defaultCookies(useSecureCookies).sessionToken.name;

  const secret =
    process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;

  const token = getSessionToken(request, cookieName);

  let auth = null;
  if (token && secret) {
    const payload = await decryptToken(token, secret, cookieName);
    if (payload) {
      auth = {
        user: {
          id: payload.id,
          email: payload.email,
          role: payload.role,
          isActive: payload.isActive,
        },
      };
    }
  }

  const result = await authConfig.callbacks.authorized({
    auth,
    request: { nextUrl: request.nextUrl },
  });

  if (result instanceof Response) return result;
  if (result === true) return NextResponse.next();

  const signInPage = authConfig.pages?.signIn ?? "/login";
  if (request.nextUrl.pathname !== signInPage) {
    const signInUrl = request.nextUrl.clone();
    signInUrl.pathname = signInPage;
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
