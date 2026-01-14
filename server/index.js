// index.js
const express = require("express");
const cors = require("cors");
require("dotenv").config(); // 读取 .env

const { PrismaClient } = require("@prisma/client");
const { PrismaBetterSqlite3 } = require("@prisma/adapter-better-sqlite3");

// 直接按照官方文档，用 url 初始化 Adapter
const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || "file:./dev.db",
});

// 传 adapter 给 PrismaClient（engine type = "client" 的要求）
const prisma = new PrismaClient({ adapter });




const app = express();
app.use(cors());
app.use(express.json());

// Node 18+ 自带 fetch，如果你用更老版本再单独装 node-fetch
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// 简单检查一下 API key
if (!OPENAI_API_KEY) {
  console.warn(
    "[WARN] OPENAI_API_KEY is not set. Please create a .env file and set OPENAI_API_KEY=..."
  );
}

/* =========================================================
 * 健康检查接口（方便测试后端是否正常）
 * =======================================================*/
app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

// 原来的测试接口
app.get("/api/hello", (req, res) => {
  res.json({ message: "Server is running!" });
});

/* =========================================================
 * 核心 0：日志写入接口 /api/log   （Prisma -> SQLite）
 * 前端会调用 logEvent(...) 来打点
 * =======================================================*/
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
    } = req.body;

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

    res.json({ ok: true, id: log.id });
  } catch (err) {
    console.error("log error", err);
    res.status(500).json({ error: "log failed" });
  }
});

/* =========================================================
 * 核心 1：原来的 AI 写作辅助接口（对整篇 text 处理）
 * POST /api/assist
 * =======================================================*/
app.post("/api/assist", async (req, res) => {
  console.log("🔥 /api/assist called with:", req.body);

  try {
    const { text, mode } = req.body;

    if (!text || !mode) {
      return res.status(400).json({ error: "Missing text or mode" });
    }

    if (!OPENAI_API_KEY) {
      return res.status(500).json({
        error: "Missing OPENAI_API_KEY",
        detail: "Please set OPENAI_API_KEY in your .env file.",
      });
    }

    // 根据 mode 构造不同的指令
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
    console.error("Server error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================================================
 * 核心 2：/llm/transform  — 只修改选中的片段
 * 前端会发送：{ action, selectedText, contextBefore, contextAfter }
 * =======================================================*/
app.post("/llm/transform", async (req, res) => {
  console.log("🔥 /llm/transform called with:", req.body);

  try {
    const { action, selectedText, contextBefore, contextAfter } = req.body;

    if (!selectedText || !action) {
      return res
        .status(400)
        .json({ error: "Missing selectedText or action" });
    }

    if (!OPENAI_API_KEY) {
      return res.status(500).json({
        error: "Missing OPENAI_API_KEY",
        detail: "Please set OPENAI_API_KEY in your .env file.",
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

Here is the surrounding context of the selected passage.

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
          {
            role: "system",
            content: "You are a helpful creative-writing assistant.",
          },
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
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================================================
 * 核心 3：/llm/feedback — Virtual Reader Personas
 * =======================================================*/
app.post("/llm/feedback", async (req, res) => {
  console.log("🔥 /llm/feedback called with:", req.body);

  try {
    const { persona, text } = req.body;

    if (!persona || !text) {
      return res.status(400).json({ error: "Missing persona or text" });
    }

    if (!OPENAI_API_KEY) {
      return res.status(500).json({
        error: "Missing OPENAI_API_KEY",
        detail: "Please set OPENAI_API_KEY in your .env file.",
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
          {
            role: "system",
            content: "You are a helpful fiction reviewer.",
          },
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

    if (content.startsWith("```")) {
      content = content.replace(/```json/gi, "").replace(/```/g, "").trim();
    }

    let comments;
    try {
      comments = JSON.parse(content);
      if (!Array.isArray(comments)) comments = [];
    } catch (e) {
      console.error(
        "Failed to parse persona feedback JSON. Raw content:",
        content
      );
      comments = [];
    }

    return res.json(comments);
  } catch (err) {
    console.error("Server error (/llm/feedback):", err);
    res.status(500).json({ error: "Server error" });
  }
});

const PORT = 4001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
