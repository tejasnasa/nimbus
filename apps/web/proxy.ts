/**
 * @module web/proxy
 * @description Next.js middleware (via `proxy`, not the default `middleware`
 * export): cookie-session route guard. Unauthenticated `/home` + `/workspace*`
 * visits redirect to `/login`; authenticated visits to public/auth pages
 * bounce to `/home`. Static/API assets are excluded via `config.matcher`.
 */
import { getSessionCookie } from "better-auth/cookies";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** Prefix-matched (auth required). */
const protectedRoutes = ["/home", "/workspace"];
/** Exact-matched (authed users bounced to /home). */
const publicRoutes = ["/login", "/", "/email-verified", "/reset-password"];

/**
 * Route guard executed on every matched request.
 *
 * @param req - Incoming request (session read from cookies, never verified
 *              here — the API re-validates on every call).
 * @returns Redirect to `/login` or `/home` when the guard trips, else `next()`.
 */
export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const isProtectedRoute = protectedRoutes.some((route) =>
    path.startsWith(route),
  );
  const isPublicRoute = publicRoutes.includes(path);

  const sessionCookie = getSessionCookie(req);

  if (isProtectedRoute && !sessionCookie) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (isPublicRoute && sessionCookie) {
    return NextResponse.redirect(new URL("/home", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|.*\\.png$).*)"],
};
