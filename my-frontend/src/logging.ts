// src/logging.ts
import { getSessionId, setSessionId } from "./session";

const API_BASE = import.meta.env.VITE_API_BASE;

async function ensureSessionId(): Promise<string> {
  // 1) try local cached
  let sid = getSessionId();
  if (sid) return sid;

  // 2) request from backend
  const res = await fetch(`${API_BASE}/api/session/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userAgent: navigator.userAgent,
      referrer: document.referrer,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`failed to start session: ${res.status} ${text}`);
  }

  const data = await res.json();
  sid = data.sessionId;
  if (!sid) throw new Error("missing sessionId from /api/session/start");

  setSessionId(sid);
  return sid;
}

export async function logEvent(params: {
  eventType: string;
  documentId?: string;
  toolName?: string;
  selectionStart?: number;
  selectionEnd?: number;
  docLength?: number;
  payload?: any;      // ✅ 兼容旧字段
  payloadJson?: any;  // ✅ 兼容新字段（如果你未来想用）
}) {
  try {
    const sessionId = await ensureSessionId();

    // 统一 payload：优先用 payloadJson，其次 payload
    const payloadObj =
      params.payloadJson !== undefined ? params.payloadJson : params.payload;

    await fetch(`${API_BASE}/api/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        eventType: params.eventType,
        documentId: params.documentId,
        toolName: params.toolName,
        selectionStart: params.selectionStart,
        selectionEnd: params.selectionEnd,
        docLength: params.docLength,
        payloadJson: payloadObj, // ✅ 后端已兼容 payloadJson / payload
      }),
    });
  } catch (err) {
    console.warn("logEvent failed", err);
  }
}
