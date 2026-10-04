/** True for /admin and everything under it, except the admin sign-in page itself. */
export function isAdminPath(pathname: string): boolean {
  if (pathname === "/admin/login" || pathname.startsWith("/admin/login/")) return false;
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

/**
 * Where to go after an admin signs in. Only same-site admin paths are allowed,
 * so a crafted ?next= can never send the admin somewhere else.
 */
export function safeAdminNext(rawNext: unknown, origin: string): string {
  const fallback = "/admin";
  if (typeof rawNext !== "string" || !rawNext.startsWith("/") || rawNext.startsWith("//")) {
    return fallback;
  }
  try {
    const url = new URL(rawNext, origin);
    if (url.origin !== origin || !isAdminPath(url.pathname)) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
