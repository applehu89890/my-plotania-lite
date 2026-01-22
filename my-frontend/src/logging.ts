// src/logging.ts
import { getSessionId } from "./session";

// const API_BASE = "http://localhost:4001";
const API_BASE = import.meta.env.VITE_API_BASE;


export async function logEvent(params: {
  eventType: string;
  sessionId?: string; // ✅ 加这一行
  documentId?: string;
  toolName?: string;
  selectionStart?: number;
  selectionEnd?: number;
  docLength?: number;
  payload?: any;
}) {
  const sessionId = getSessionId();

  try {
    await fetch(`${API_BASE}/api/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        ...params,
      }),
    });
  } catch (err) {
    console.warn("logEvent failed", err);
  }
}
