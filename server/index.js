// server/index.js
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const { PrismaClient } = require("@prisma/client");
const { PrismaBetterSqlite3 } = require("@prisma/adapter-better-sqlite3");

// ------------------------------
// Prisma (SQLite - dev/local friendly)
// NOTE: On cloud, SQLite file can be unstable; later migrate to Postgres.
// ------------------------------
const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || "file:./dev.db",
});
const prisma = new PrismaClient({ adapter });

// ------------------------------
// App + Middleware (ONLY ONCE, BEFORE routes)
// ------------------------------
const app = express();
app.use(express.json());

// ✅ CORS: allow local + your Vercel domain + optional extra origin (Render deploy etc.)
const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "https://my-plotania-lite.vercel.app",
];

// You can set: ALLOWED_ORIGINS="https://xxx.vercel.app,https://yyy.onrender.com"
const extraOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const allowedOrigins = Array.from(
  new Set([...DEFAULT_ALLOWED_ORIGINS, ...extraOrigins])
);

app.use(
  cors({
    origin: function (origin, callback) {
      // allow non-browser clients (curl/postman/no origin)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
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

// Node 18+ has fetch
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.warn(
    "[WARN] OPENAI_API_KEY is not set. Set it in Render/Env or local .env"
  );
}

// ------------------------------
// Health checks
// ------------------------------
app.get("/health", (req, res) => res.json({ ok: true }));
app.get("/api/health", (req, res) => res.json({ ok: true }));

// Basic hello
app.get("/api/hello", (req, res) => {
  res.json({ message: "Server is running!" });
});

// ------------------------------
// Logging: POST /api/log  (Prisma -> SQLite)
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
      payload,
    } = req.body || {};

    if (!sessionId || !eventType) {
      return res
        .status(400)
        .json({ error: "sessionId and eventType are required" });
    }

    const log = await prisma.logEvent.create({
      data: {
        sessionId,
        documentId,
        eventType,
        toolName,
        selectionStart,
        selectionEnd,
        docLength,
        payloadJson: JSON.stringify(payload ?? {}),
      },
    });

    return res.json({ ok: true, id: log.id });
  } catch (err) {
    console.error("log error", err);
    return res.status(500).json({ error: "log failed" });
  }
});

// ------------------------------
// AI Assist: POST /api/assist   (whole text)
// body: { text, mode }
// ------------------------------
app.post("/api/assist", async (req, res) => {
  console.log("🔥 /api/assist called with:", req.body);

  try {
    const { text, mode } = req.body || {};

    if (!text || !mode) {
      return res.status(400).json({ error: "Missing text or mode" });
    }

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
        instruction =
          "Expand the text with more detail, while keeping the original meaning.";
        break;
      case "shorten":
        instruction =
          "Shorten the text while preserving the key information and tone.";
        break;
      case "tone":
        instruction =
          "Adjust the tone to be more natural, engaging, and suitable for a general reader.";
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
      return res
        .status(500)
        .json({ error: "OpenAI API error", detail: errorText });
    }

    const data = await response.json();
    const aiText =
      data.choices?.[0]?.message?.content?.trim() ||
      "No response from AI model.";

    const originalWordCount = text.trim().split(/\s+/).length;
    const suggestionWordCount = aiText.trim().split(/\s+/).length;
    const wordDiff = suggestionWordCount - originalWordCount;

    return res.json({
      result: aiText,
      meta: { wordDiff },
    });
  } catch (err) {
    console.error("Server error (/api/assist):", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ------------------------------
// Transform: POST /llm/transform  (selected text only)
// body: { action, selectedText, contextBefore, contextAfter }
// ------------------------------
app.post("/llm/transform", async (req, res) => {
  console.log("🔥 /llm/transform called with:", req.body);

  try {
    const { action, selectedText, contextBefore, contextAfter } = req.body || {};

    if (!selectedText || !action) {
      return res
        .status(400)
        .json({ error: "Missing selectedText or action" });
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
        instruction =
          "Expand the selected text with more detail, keeping the same storyline and style.";
        break;
      case "shorten":
        instruction =
          "Shorten the selected text while keeping the key meaning and tone.";
        break;
      case "tone":
        instruction =
          "Adjust the tone of the selected text to be more natural and engaging for general readers.";
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
Please transform ONLY the selected text, so that it still fits smoothly into the given context.
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
      return res
        .status(500)
        .json({ error: "OpenAI API error", detail: errorText });
    }

    const data = await response.json();
    const aiText =
      data.choices?.[0]?.message?.content?.trim() ||
      "No response from AI model.";

    const originalWordCount = selectedText.trim().split(/\s+/).length;
    const suggestionWordCount = aiText.trim().split(/\s+/).length;
    const wordDiff = suggestionWordCount - originalWordCount;

    return res.json({
      result: aiText,
      meta: { wordDiff },
    });
  } catch (err) {
    console.error("Server error (/llm/transform):", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ------------------------------
// Persona Feedback: POST /llm/feedback
// body: { persona, text }
// returns JSON array
// ------------------------------
app.post("/llm/feedback", async (req, res) => {
  console.log("🔥 /llm/feedback called with:", req.body);

  try {
    const { persona, text } = req.body || {};

    if (!persona || !text) {
      return res.status(400).json({ error: "Missing persona or text" });
    }

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

Provide 3–6 concrete comments in JSON format.
Each comment should be an object with keys:
- "id": a short unique string id (like "c1", "c2", etc.)
- "persona": the persona id you are using (e.g. "${persona}")
- "excerpt": a short quoted excerpt from the text that you are commenting on
- "comment": what you notice (what's working or not)
- "suggestion": a specific suggestion for improvement

Return ONLY a JSON array, no explanation, no surrounding text.
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
      return res
        .status(500)
        .json({ error: "OpenAI API error", detail: errorText });
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content?.trim() || "[]";

    // strip ```json fences if any
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
// (Optional) Centralized error handler for CORS errors etc.
// ------------------------------
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err?.message || err);
  res.status(500).json({ error: "Server error", detail: err?.message || String(err) });
});

// ------------------------------
// Start
// ------------------------------
const PORT = process.env.PORT || 4001;
app.listen(PORT, () => {
  console.log(`API listening on ${PORT}`);
  console.log(`Allowed origins: ${allowedOrigins.join(", ")}`);
});
