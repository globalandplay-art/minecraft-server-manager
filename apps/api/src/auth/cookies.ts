const COOKIE = "mcsm_local_session";
/** Cookie-only authentication; ambiguous duplicates never select a credential. */
export function localSessionCookie(header: string | undefined): string | undefined {
  return sessionCookie(header, COOKIE);
}
export function remoteSessionCookie(header: string | undefined): string | undefined {
  return sessionCookie(header, "__Host-mcsm_remote_session");
}
function sessionCookie(header: string | undefined, name: string): string | undefined {
  if (!header || header.length > 8192) return undefined;
  const values = header.split(";").map((part) => part.trim()).filter((part) => part.split("=", 1)[0] === name);
  if (values.length !== 1) return undefined;
  const value = values[0]!.slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/u.test(value) ? value : undefined;
}
