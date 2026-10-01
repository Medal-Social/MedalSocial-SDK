/**
 * Leave the portal with ONE full document load — after a logout or a delete.
 *
 * A `router.push` + `router.refresh` pair is two round-trips, and a push to a
 * page under another root layout ends in a hard load anyway. A document load
 * is a fresh page and drops the router cache holding the old dashboard in one
 * go. `replace` for the delete, so Back cannot return to a dashboard whose
 * account is gone; `assign` for the logout, where Back simply meets the login.
 *
 * Its own module so a test can stand in for `window.location`.
 */
export function leavePortal(path: string, { replace = false }: { replace?: boolean } = {}): void {
  if (replace) window.location.replace(path);
  else window.location.assign(path);
}
