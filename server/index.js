// server/index.js
console.log("BOOT VERSION: 2026-01-28 prisma7-adapter");

const express = require("express");
const cors = require("cors");
require("dotenv").config();

const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

// ------------------------------
// Env checks
// ------------------------------
if (!process.env.DATABASE_URL) {
  throw new Error("Missing DATABASE_URL in environment variables.");
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.warn("[WARN] OPENAI_API_KEY is not set.");
}

// ------------------------------
// Prisma (Prisma 7: use adapter)
// ------------------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // 如果之后遇到 SSL 报错，再打开：
  // ssl: { rejectUnauthorized: false },
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ------------------------------
// App + Middleware
// ------------------------------
const app = express();
app.use(express.json());

// ✅ CORS: allow local + Vercel prod + Vercel preview + optional extra origins
const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "https://my-plotania-lite.vercel.app",
];

const extraOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const allowedOrigins = Array.from(
  new Set([...DEFAULT_ALLOWED_ORIGINS, ...extraOrigins])
);

const isVercelPreviewOrigin = (origin) =>
  /^https:\/\/my-plotania-lite-.*-applehu89890s-projects\.vercel\.app$/.test(
    origin
  );

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      if (isVercelPreviewOrigin(origin)) return callback(null, true);

      return callback(
        new Error(
          `CORS blocked: Origin ${origin} not allowed. Allowed: ${allowedOrigins.join(
            ", "
          )}`
        )
      );
    },
    methods: ["GET", "POST", "OPTIONS"],
    credentials: false,
  })
);

// ------------------------------
// Health checks
// ------------------------------
app.get("/health", (req, res) => res.json({ ok: true }));
app.get("/api/health", (req, res) => res.json({ ok: true }));

app.get("/api/hello", (req, res) => {
  res.json({ message: "Server is running!" });
});

// ✅ DB check
app.get("/api/db-check", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: "connected" });
  } catch (err) {
    console.error("db-check error:", err);
    res.status(500).json({ ok: false, error: "db not connected" });
  }
});

// ------------------------------
// Session: POST /api/session/start
// ------------------------------
app.post("/api/session/start", async (req, res) => {
  try {
    const session = await prisma.session.create({ data: {} });
    res.json({ sessionId: session.id });
  } catch (err) {
    console.error("session start error:", err);
    res.status(500).json({ error: "failed to start session" });
  }
});

// ------------------------------
// Logging: POST /api/log
// ------------------------------
app.post("/api/log", async (req, res) => {
  try {
    const {
      sessionId,
      documentId,
      eventType,
      toolName,
      selectionStart,
      selectionEnd,
      docLength,
      payloadJson,
      payload,
    } = req.body || {};

    if (!sessionId || !eventType) {
      return res
        .status(400)
        .json({ error: "sessionId and eventType are required" });
    }

    // ✅ 确保 session 一定存在（避免 FK 错误）
    await prisma.session.upsert({
      where: { id: sessionId },
      update: {},
      create: { id: sessionId },
    });

    // ✅ 核心修复：只在 Document 真存在时才写 documentId
    let safeDocumentId = null;
    if (documentId) {
      const exists = await prisma.document.findUnique({
        where: { id: documentId },
        select: { id: true },
      });
      if (exists) safeDocumentId = documentId;
    }

    const log = await prisma.logEvent.create({
      data: {
        sessionId,
        documentId: safeDocumentId, // ← 关键
        eventType,
        toolName: toolName || null,
        selectionStart: selectionStart ?? null,
        selectionEnd: selectionEnd ?? null,
        docLength: docLength ?? null,
        payloadJson: payloadJson ?? payload ?? null,
      },
    });

    return res.json({ ok: true, id: log.id });
  } catch (err) {
    console.error("log error", err);
    return res.status(500).json({ error: "log failed" });
  }
});


// ------------------------------
// AI Assist: POST /api/assist
// ------------------------------
app.post("/api/assist", async (req, res) => {
  try {
    const { text, mode } = req.body || {};
    if (!text || !mode) return res.status(400).json({ error: "Missing text or mode" });
    if (!OPENAI_API_KEY) {
      return res.status(500).json({
        error: "Missing OPENAI_API_KEY",
        detail: "Set OPENAI_API_KEY in your environment variables.",
      });
    }

    let instruction;
    switch (mode) {
      case "rewrite":
        instruction = "Rewrite the text for clarity and better readability.";
        break;
      case "expand":
        instruction = "Expand the text with more detail, while keeping the original meaning.";
        break;
      case "shorten":
        instruction = "Shorten the text while preserving the key information and tone.";
        break;
      case "tone":
        instruction = "Adjust the tone to be more natural, engaging, and suitable for a general reader.";
        break;
      default:
        instruction = "Rewrite and improve the following text.";
    }

    const prompt = `${instruction}\n\nText:\n"""${text}"""\n\nReturn only the revised text, no explanations.`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "You are a helpful writing assistant." },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenAI API error:", errorText);
      return res.status(500).json({ error: "OpenAI API error", detail: errorText });
    }

    const data = await response.json();
    const aiText = data.choices?.[0]?.message?.content?.trim() || "No response from AI model.";

    const originalWordCount = text.trim().split(/\s+/).length;
    const suggestionWordCount = aiText.trim().split(/\s+/).length;

    return res.json({ result: aiText, meta: { wordDiff: suggestionWordCount - originalWordCount } });
  } catch (err) {
    console.error("Server error (/api/assist):", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ------------------------------
// Transform: POST /llm/transform
// ------------------------------
app.post("/llm/transform", async (req, res) => {
  try {
    const { action, selectedText, contextBefore, contextAfter } = req.body || {};
    if (!selectedText || !action) {
      return res.status(400).json({ error: "Missing selectedText or action" });
    }
    if (!OPENAI_API_KEY) {
      return res.status(500).json({
        error: "Missing OPENAI_API_KEY",
        detail: "Set OPENAI_API_KEY in your environment variables.",
      });
    }

    let instruction;
    switch (action) {
      case "rewrite":
        instruction = "Rewrite the selected text for clarity and flow.";
        break;
      case "expand":
        instruction = "Expand the selected text with more detail, keeping the same storyline and style.";
        break;
      case "shorten":
        instruction = "Shorten the selected text while keeping the key meaning and tone.";
        break;
      case "tone":
        instruction = "Adjust the tone of the selected text to be more natural and engaging for general readers.";
        break;
      default:
        instruction = "Rewrite and improve the selected text.";
    }

    const prompt = `
You are helping a writer edit part of a story.

Action: ${action}

Context before:
${contextBefore || "(none)"}

Selected text:
"""${selectedText}"""

Context after:
${contextAfter || "(none)"}

${instruction}
Return only the revised version of the selected text, with no additional commentary.
    `.trim();

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "You are a helpful creative-writing assistant." },
          { role: "user", content: prompt },
        ],
        temperature: 0.8,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenAI API error (transform):", errorText);
      return res.status(500).json({ error: "OpenAI API error", detail: errorText });
    }

    const data = await response.json();
    const aiText = data.choices?.[0]?.message?.content?.trim() || "No response from AI model.";

    const originalWordCount = selectedText.trim().split(/\s+/).length;
    const suggestionWordCount = aiText.trim().split(/\s+/).length;

    return res.json({ result: aiText, meta: { wordDiff: suggestionWordCount - originalWordCount } });
  } catch (err) {
    console.error("Server error (/llm/transform):", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ------------------------------
// Persona Feedback: POST /llm/feedback
// ------------------------------
app.post("/llm/feedback", async (req, res) => {
  try {
    const { persona, text } = req.body || {};
    if (!persona || !text) return res.status(400).json({ error: "Missing persona or text" });
    if (!OPENAI_API_KEY) {
      return res.status(500).json({
        error: "Missing OPENAI_API_KEY",
        detail: "Set OPENAI_API_KEY in your environment variables.",
      });
    }

    let personaPrompt;
    switch (persona) {
      case "ruthless_reviewer":
        personaPrompt = `
You are a ruthless but constructive fiction reviewer.
Focus on coherence, pacing, plot holes, and logical consistency.
Be honest but helpful.
`;
        break;
      case "emotional_reader":
        personaPrompt = `
You are an emotionally engaged beta reader.
Focus on engagement, emotional impact, and how the characters make you feel.
`;
        break;
      case "stylistic_mentor":
        personaPrompt = `
You are a stylistic mentor who cares about style, voice, and sentence-level craft.
Focus on prose quality, clarity, and clichés.
`;
        break;
      default:
        personaPrompt = `
You are a thoughtful fiction reviewer who gives concrete, helpful feedback.
`;
    }

    const userPrompt = `
${personaPrompt}

Here is the text the author wrote:
"""${text}"""

Return ONLY a JSON array (3–6 items). Each item has:
"id", "persona", "excerpt", "comment", "suggestion".
`.trim();

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "You are a helpful fiction reviewer." },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.8,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenAI API error (feedback):", errorText);
      return res.status(500).json({ error: "OpenAI API error", detail: errorText });
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content?.trim() || "[]";

    if (content.startsWith("```")) {
      content = content.replace(/```json/gi, "").replace(/```/g, "").trim();
    }

    let comments;
    try {
      comments = JSON.parse(content);
      if (!Array.isArray(comments)) comments = [];
    } catch (e) {
      console.error("Failed to parse persona feedback JSON. Raw:", content);
      comments = [];
    }

    return res.json(comments);
  } catch (err) {
    console.error("Server error (/llm/feedback):", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ------------------------------
// Error handler
// ------------------------------
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err?.message || err);
  res.status(500).json({ error: "Server error", detail: err?.message || String(err) });
});

// ------------------------------
// Graceful shutdown (good for Render)
// ------------------------------
process.on("SIGINT", async () => {
  try { await prisma.$disconnect(); } catch (e) {}
  process.exit(0);
});
process.on("SIGTERM", async () => {
  try { await prisma.$disconnect(); } catch (e) {}
  process.exit(0);
});

// ------------------------------
// Start
// ------------------------------
const PORT = process.env.PORT || 4001;
app.listen(PORT, () => {
  console.log(`API listening on ${PORT}`);
  console.log(`Allowed origins: ${allowedOrigins.join(", ")}`);
});
