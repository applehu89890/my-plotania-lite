// src/session.ts
const SESSION_KEY = "plotania_session_id";

/**
 * Only READ cached sessionId.
 * Creation must be done by backend (/api/session/start).
 */
export function getSessionId(): string {
  if (typeof window === "undefined") return "";

  return window.localStorage.getItem(SESSION_KEY) || "";
}

/**
 * Cache sessionId returned from backend.
 */
export function setSessionId(id: string) {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(SESSION_KEY, id);
}
