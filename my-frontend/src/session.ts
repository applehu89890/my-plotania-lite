// src/session.ts
const SESSION_KEY = "plotania_session_id";

export function getSessionId(): string {
  if (typeof window === "undefined") return "server-session";

  let id = window.localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}
