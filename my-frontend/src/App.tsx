// App.tsx
import React, { useState } from "react";
import EditorWithToolbar from "./EditorWithToolbar";
import "./styles.css";
import { logEvent } from "./logging";

type ActionMode = "rewrite" | "expand" | "shorten" | "tone";

type AISuggestion = {
  original: string;
  suggestion: string;
  mode: ActionMode;
  from: number;
  to: number;
};

type SaveStatus = "saved" | "editing" | "saving";

/* ---------------- Module B Types ---------------- */

type PersonaId = "ruthless_reviewer" | "emotional_reader" | "stylistic_mentor";

type PersonaConfig = {
  id: PersonaId;
  name: string;
  tagline: string;
  focus: string;
};

const PERSONAS: PersonaConfig[] = [
  {
    id: "ruthless_reviewer",
    name: "Ruthless Reviewer",
    tagline: 'My comment will be "sharp and brutally honest".',
    focus: "Picks apart weak structure, pacing, and logic.",
  },
  {
    id: "emotional_reader",
    name: "Emotional Reader",
    tagline: "I'm caught up with the story; here's how it feels to read.",
    focus: "Focuses on engagement, emotional impact, and character feelings.",
  },
  {
    id: "stylistic_mentor",
    name: "Stylistic Mentor",
    tagline: "I care about style, voice, and sentence-level craft.",
    focus: "Helps polish prose and avoid clichés.",
  },
];

type PersonaCommentStatus = "open" | "resolved" | "hidden";

type PersonaComment = {
  id: string;
  persona: PersonaId;
  excerpt: string;
  comment: string;
  suggestion: string;
  status: PersonaCommentStatus;
};

type SelectionRange = { from: number; to: number } | null;

const getPersonaName = (id: PersonaId): string => {
  const p = PERSONAS.find((x) => x.id === id);
  return p ? p.name : id;
};

/* ---------------- UI copy helpers ---------------- */

const MODE_LABEL: Record<ActionMode, string> = {
  rewrite: "Generate",
  expand: "Revision",
  shorten: "Adjust Length",
  tone: "Optimize",
};

const modeToEnglish = (mode: ActionMode): string => {
  switch (mode) {
    case "rewrite":
      return "Rewrite";
    case "expand":
      return "Expand";
    case "shorten":
      return "Adjust length";
    case "tone":
      return "Adjust tone";
    default:
      return mode;
  }
};

const clip = (s: string, max = 120) => {
  const t = (s ?? "").trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + "…";
};

function App() {
  /* ---------------- Session / Document IDs for logging ---------------- */

  const [sessionId] = useState(() => {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return (crypto as any).randomUUID();
    }
    return "sess-" + Math.random().toString(36).slice(2);
  });

  const [documentId] = useState("doc-1");

  /* ---------------- Existing State ---------------- */

  const [editorText, setEditorText] = useState("");

  // ✅ "What's working" = action summary
  const [workingText, setWorkingText] = useState(
    "Select a sentence on the left, then click an action button above to get an AI suggestion."
  );

  // ✅ "What needs improvement" = current suggestion / next step hint
  const [improveText, setImproveText] = useState(
    "AI suggestions will appear here. Click Replace to apply them to the editor."
  );

  const [loadingAction, setLoadingAction] = useState<ActionMode | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState<AISuggestion | null>(null);
  const [editorInstance, setEditorInstance] = useState<any | null>(null);

  const [docTitle, setDocTitle] = useState("Untitled document");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");

  /* ---------------- Module B State ---------------- */

  const [personaComments, setPersonaComments] = useState<PersonaComment[]>([]);
  const [personaLoadingId, setPersonaLoadingId] = useState<PersonaId | null>(
    null
  );
  // remember selection when requesting persona feedback (for excerpt highlight)
  const [lastFeedbackSelection, setLastFeedbackSelection] =
    useState<SelectionRange>(null);

  /* ---------------- Module C State (Attribution) ---------------- */

  const [humanChars, setHumanChars] = useState(0);
  const [aiChars, setAiChars] = useState(0);

  // ✅ C2: show AI highlights toggle
  const [showAIOrigins, setShowAIOrigins] = useState(true);

  // update humanChars based on total length and current aiChars
  const handleDocumentChange = (fullText: string) => {
    const total = fullText.length;
    setHumanChars(Math.max(total - aiChars, 0));
  };

  /* ---------------- Utility: Save ---------------- */

  const handleManualSave = () => {
    setSaveStatus("saving");

    // ✅ logging — Save click
    logEvent({
      sessionId,
      documentId,
      eventType: "save_click",
      docLength: editorText.length,
      payload: {
        title: docTitle,
      },
    });

    setTimeout(() => {
      setSaveStatus("saved");
      setWorkingText(
        "Saved. You can keep editing or use an AI tool on a selected passage."
      );
    }, 500);
  };

  /* ---------------- Utility: Get selected text ---------------- */
  const getSelectedOrFullText = (): string => {
    if (!editorInstance) return editorText;

    const editor = editorInstance;
    const { from, to } = editor.state.selection;

    let selected = editor.state.doc.textBetween(from, to, "\n");

    if (!selected || selected.trim().length === 0) {
      selected = editor.state.doc.textBetween(
        0,
        editor.state.doc.content.size,
        "\n"
      );
    }

    return selected.trim();
  };

  /* ---------------- Module A: build transform payload ---------------- */

  const buildTransformPayload = (mode: ActionMode) => {
    if (!editorInstance) return null;

    const editor = editorInstance;
    const { from, to } = editor.state.selection;

    const fullText: string = editor.state.doc.textBetween(
      0,
      editor.state.doc.content.size,
      "\n"
    );

    let selectedText: string = editor.state.doc.textBetween(from, to, "\n");

    if (!selectedText || selectedText.trim().length === 0) {
      selectedText = fullText;
    }

    const paragraphs = fullText.split(/\n{2,}/);
    let contextBefore = "";
    let contextAfter = "";

    const trimmedSel = selectedText.trim();
    const idx = paragraphs.findIndex((p) => p.includes(trimmedSel));

    if (idx !== -1) {
      if (idx > 0) contextBefore = paragraphs[idx - 1];
      if (idx < paragraphs.length - 1) contextAfter = paragraphs[idx + 1];
    }

    return {
      action: mode,
      selectedText,
      contextBefore,
      contextAfter,
      from,
      to,
      fullText,
    };
  };

  /* ---------------- Module A: transform call (BACKEND) ---------------- */

  const callBackend = async (mode: ActionMode) => {
    try {
      setLoadingAction(mode);

      const payload: any = buildTransformPayload(mode);
      if (!payload) {
        setImproveText("Editor is not ready yet. Please try again.");
        return;
      }

      // ✅ "What's working": show current action + selected text
      const excerpt = clip(payload.selectedText, 140);
      setWorkingText(
        `Running: ${modeToEnglish(mode)} (${MODE_LABEL[mode]}). Selected: “${excerpt}”`
      );
      setImproveText("Generating a suggestion…");

      // ✅ logging — AI tool usage
      logEvent({
        sessionId,
        documentId,
        eventType: "ai_tool",
        toolName: mode,
        selectionStart: payload.from,
        selectionEnd: payload.to,
        docLength: payload.fullText.length,
        payload: {
          selectedTextLength: payload.selectedText.length,
        },
      });

      // ✅ frontend calls backend; backend calls OpenAI
      const res = await fetch("http://localhost:4001/llm/transform", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: payload.action,
          selectedText: payload.selectedText,
          contextBefore: payload.contextBefore,
          contextAfter: payload.contextAfter,
          from: payload.from,
          to: payload.to,
        }),
      });

      const raw = await res.text();

      if (!res.ok) {
        console.error("Backend /llm/transform error:", raw);
        throw new Error(`Backend error ${res.status}: ${raw}`);
      }

      const data = JSON.parse(raw);
      const aiText = (data.result ?? data.text ?? "") as string;

      setAiSuggestion({
        original: payload.selectedText,
        suggestion: aiText,
        mode,
        from: payload.from,
        to: payload.to,
      });

      // ✅ "What needs improvement": show AI suggestion (before Replace)
      setImproveText(aiText || "(No output returned. Please try again.)");
    } catch (err: any) {
      setImproveText(`Backend call failed: ${err.message}`);
    } finally {
      setLoadingAction(null);
    }
  };

  /* ---------------- Accept suggestion (Module C hook-in + AI highlights) ---------------- */

  const handleAcceptSuggestion = () => {
    if (!aiSuggestion || !editorInstance) return;

    const { from, to, suggestion, mode, original } = aiSuggestion;

    // replace selected text with AI suggestion + mark as aiText
    editorInstance
      .chain()
      .focus()
      .deleteRange({ from, to })
      .setTextSelection(from)
      .setMark("aiText")
      .insertContent(suggestion)
      .unsetMark("aiText")
      .run();

    const newText: string = editorInstance.getText();

    // --- Module C: update AI / Human counts ---
    const total = newText.length;
    setAiChars((prevAi) => {
      const nextAi = prevAi + suggestion.length;
      setHumanChars(Math.max(total - nextAi, 0));
      return nextAi;
    });

    setEditorText(newText);
    setSaveStatus("editing");

    // ✅ summary after Replace
    setWorkingText(
      `Applied: ${modeToEnglish(mode)} (${MODE_LABEL[mode]}) and replaced the selection. “${clip(
        original,
        160
      )}”`
    );
    setImproveText(
      "Replacement applied. Select another passage to generate a new suggestion."
    );

    setAiSuggestion(null);

    // ✅ logging — accept suggestion
    logEvent({
      sessionId,
      documentId,
      eventType: "accept_suggestion",
      toolName: mode,
      docLength: newText.length,
      payload: {
        originalLength: original.length,
        suggestionLength: suggestion.length,
      },
    });
  };

  const handleDismissSuggestion = () => {
    if (aiSuggestion) {
      setWorkingText(
        `Dismissed: ${modeToEnglish(aiSuggestion.mode)} (${MODE_LABEL[
          aiSuggestion.mode
        ]}). The suggestion was not applied.`
      );
      setImproveText(
        "You can select a passage again and generate a new suggestion."
      );
    }

    setAiSuggestion(null);

    // optional: log dismiss
    logEvent({
      sessionId,
      documentId,
      eventType: "dismiss_suggestion",
      docLength: editorText.length,
    });
  };

  /* ---------------- Module B: Persona Feedback (B1+B2) ---------------- */

  const handleGetFeedback = async (personaId: PersonaId) => {
    if (!editorInstance) return;

    const editor = editorInstance;
    const { from, to } = editor.state.selection;

    // remember selection for excerpt highlight later
    let feedbackFrom = from;
    let feedbackTo = to;

    // if nothing selected, use full doc
    const fullSize = editor.state.doc.content.size;
    let selectedPassage = editor.state.doc.textBetween(from, to, "\n");
    if (!selectedPassage || selectedPassage.trim().length === 0) {
      selectedPassage = editor.state.doc.textBetween(0, fullSize, "\n");
      feedbackFrom = 1;
      feedbackTo = fullSize;
    }

    if (!selectedPassage || selectedPassage.trim().length === 0) {
      setImproveText("Please select a passage or write something first.");
      return;
    }

    setLastFeedbackSelection({ from: feedbackFrom, to: feedbackTo });

    // ✅ logging — request persona feedback
    logEvent({
      sessionId,
      documentId,
      eventType: "persona_feedback_request",
      toolName: personaId,
      selectionStart: feedbackFrom,
      selectionEnd: feedbackTo,
      docLength: editor.state.doc.textBetween(0, fullSize, "\n").length,
      payload: {
        excerptLength: selectedPassage.length,
      },
    });

    try {
      setPersonaLoadingId(personaId);

      const res = await fetch("http://localhost:4001/llm/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          persona: personaId,
          text: selectedPassage.trim(),
        }),
      });

      const raw = await res.text();

      if (!res.ok) {
        console.error("Persona feedback error:", raw);
        return;
      }

      const data = JSON.parse(raw);
      const commentsRaw: any[] = Array.isArray(data) ? data : [];

      const comments: PersonaComment[] = commentsRaw.map((c) => ({
        id: c.id ?? `${personaId}-${Math.random().toString(36).slice(2)}`,
        persona: personaId,
        excerpt: c.excerpt ?? "",
        comment: c.comment ?? "",
        suggestion: c.suggestion ?? "",
        status: "open",
      }));

      setPersonaComments((prev) => [...prev, ...comments]);

      // optional: log how many comments returned
      logEvent({
        sessionId,
        documentId,
        eventType: "persona_feedback_received",
        toolName: personaId,
        docLength: editor.state.doc.textBetween(0, fullSize, "\n").length,
        payload: {
          commentsCount: comments.length,
        },
      });
    } catch (err) {
      console.error("Persona feedback error:", err);
    } finally {
      setPersonaLoadingId(null);
    }
  };

  /** click excerpt to highlight remembered selection */
  const handleExcerptClick = () => {
    if (!editorInstance || !lastFeedbackSelection) return;

    const { from, to } = lastFeedbackSelection;

    editorInstance.chain().focus().setTextSelection({ from, to }).run();

    logEvent({
      sessionId,
      documentId,
      eventType: "persona_excerpt_click",
      docLength: editorInstance.getText().length,
    });
  };

  /** Mark resolved / Hide */

  const handleResolveComment = (id: string) => {
    setPersonaComments((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status: "resolved" } : c))
    );

    logEvent({
      sessionId,
      documentId,
      eventType: "persona_comment_resolved",
      docLength: editorText.length,
      payload: { commentId: id },
    });
  };

  const handleHideComment = (id: string) => {
    setPersonaComments((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status: "hidden" } : c))
    );

    logEvent({
      sessionId,
      documentId,
      eventType: "persona_comment_hidden",
      docLength: editorText.length,
      payload: { commentId: id },
    });
  };

  /* ---------------- Module C: derived percentages ---------------- */

  const totalChars = humanChars + aiChars;
  const humanPercent =
    totalChars === 0 ? 0 : Math.round((humanChars / totalChars) * 100);
  const aiPercent = totalChars === 0 ? 0 : 100 - humanPercent;

  /* ---------------- UI ---------------- */

  return (
    <div className="app-root">
      <header className="top-bar">
        <div className="app-title">Plotania – AI Writing Assistant</div>

        <div className="top-bar-right">
          <input
            className="doc-title-input"
            value={docTitle}
            onChange={(e) => {
              setDocTitle(e.target.value);
              setSaveStatus("editing");

              logEvent({
                sessionId,
                documentId,
                eventType: "title_change",
                docLength: editorText.length,
                payload: { title: e.target.value },
              });
            }}
            placeholder="Document title"
          />
          <span className={`save-status save-status-${saveStatus}`}>
            {saveStatus === "saved" && "Saved"}
            {saveStatus === "editing" && "Editing…"}
            {saveStatus === "saving" && "Saving…"}
          </span>
          <button className="save-btn" onClick={handleManualSave}>
            Save
          </button>
        </div>
      </header>

      <main className="workspace">
        {/* Left editor */}
        <section className="editor-pane">
          <div className="action-bar">
            <button
              className="action-btn"
              onClick={() => callBackend("rewrite")}
              disabled={loadingAction === "rewrite"}
            >
              {loadingAction === "rewrite" ? "Generating..." : "Generate"}
            </button>

            <button
              className="action-btn"
              onClick={() => callBackend("expand")}
              disabled={loadingAction === "expand"}
            >
              {loadingAction === "expand" ? "Revising..." : "Revision"}
            </button>

            <button
              className="action-btn"
              onClick={() => callBackend("shorten")}
              disabled={loadingAction === "shorten"}
            >
              {loadingAction === "shorten" ? "Adjusting..." : "Adjust Length"}
            </button>

            <button
              className="action-btn"
              onClick={() => callBackend("tone")}
              disabled={loadingAction === "tone"}
            >
              {loadingAction === "tone" ? "Optimizing..." : "Optimize"}
            </button>
          </div>

          <EditorWithToolbar
            onChange={(text: string) => {
              setEditorText(text);
              setSaveStatus("editing");

              handleDocumentChange(text);

              logEvent({
                sessionId,
                documentId,
                eventType: "editor_change",
                docLength: text.length,
              });
            }}
            onEditorReady={setEditorInstance}
            showAIOrigins={showAIOrigins as any}
          />
        </section>

        {/* Right sidebar */}
        <aside className="feedback-pane">
          <h2>AI Suggestions</h2>

          <h3>What's working:</h3>
          <p>{workingText}</p>

          <h3>What needs improvement:</h3>
          <p>{improveText}</p>

          {aiSuggestion && (
            <>
              <hr style={{ margin: "16px 0" }} />

              <div className="suggestion-meta">
                <p>
                  Mode: <strong>{aiSuggestion.mode}</strong>
                  <span style={{ marginLeft: 8 }}>
                    Δwords:
                    {aiSuggestion.suggestion.trim().split(/\s+/).length -
                      aiSuggestion.original.trim().split(/\s+/).length}
                  </span>
                </p>
              </div>

              <div className="suggestion-compare">
                <div className="suggestion-column">
                  <h3>Original</h3>
                  <pre className="suggestion-text">{aiSuggestion.original}</pre>
                </div>

                <div className="suggestion-column">
                  <h3>AI Suggestion</h3>
                  <pre className="suggestion-text">
                    {aiSuggestion.suggestion}
                  </pre>
                </div>
              </div>

              <div className="suggestion-actions">
                <button className="primary-btn" onClick={handleAcceptSuggestion}>
                  Replace
                </button>
                <button
                  className="secondary-btn"
                  onClick={handleDismissSuggestion}
                >
                  Dismiss
                </button>
              </div>
            </>
          )}

          {/* -------- Attribution Statistics (Module C UI) -------- */}
          <hr style={{ margin: "20px 0" }} />

          <section className="attribution-section">
            <h3>Attribution Statistics</h3>
            <div className="attribution-cards">
              <div
                className={
                  "attrib-card" +
                  (aiPercent >= humanPercent ? " attrib-card-active" : "")
                }
              >
                <div className="attrib-label-row">
                  <span className="attrib-dot ai-dot" />
                  <span className="attrib-label-text">AI</span>
                </div>
                <div className="attrib-value">{aiPercent}%</div>
              </div>

              <div
                className={
                  "attrib-card" +
                  (humanPercent > aiPercent ? " attrib-card-active" : "")
                }
              >
                <div className="attrib-label-row">
                  <span className="attrib-dot human-dot" />
                  <span className="attrib-label-text">Human</span>
                </div>
                <div className="attrib-value">{humanPercent}%</div>
              </div>
            </div>

            <label className="ai-origins-toggle">
              <input
                type="checkbox"
                checked={showAIOrigins}
                onChange={(e) => {
                  setShowAIOrigins(e.target.checked);

                  logEvent({
                    sessionId,
                    documentId,
                    eventType: "toggle_ai_origins",
                    docLength: editorText.length,
                    payload: { value: e.target.checked },
                  });
                }}
              />
              Show AI origins
            </label>
          </section>

          {/* -------- Virtual Readers -------- */}
          <hr style={{ margin: "20px 0" }} />
          <h3>Virtual Readers</h3>

          <div className="persona-list">
            {PERSONAS.map((p) => (
              <div key={p.id} className="persona-card">
                <div className="persona-name">{p.name}</div>
                <div className="persona-tagline">{p.tagline}</div>
                <div className="persona-focus">{p.focus}</div>

                <button
                  className="persona-btn"
                  onClick={() => handleGetFeedback(p.id)}
                  disabled={personaLoadingId === p.id}
                >
                  {personaLoadingId === p.id ? "Getting..." : "Get feedback"}
                </button>
              </div>
            ))}
          </div>

          {/* Persona Comments */}
          {personaComments.some((c) => c.status !== "hidden") && (
            <section className="persona-feedback-list">
              <h3>Persona Feedback</h3>

              {personaComments
                .filter((c) => c.status !== "hidden")
                .map((c) => (
                  <div
                    key={c.id}
                    className={`persona-comment-card ${
                      c.status === "resolved" ? "persona-comment-resolved" : ""
                    }`}
                  >
                    <div className="persona-comment-header">
                      <span className="persona-pill">
                        {getPersonaName(c.persona)}
                      </span>
                      {c.status === "resolved" && (
                        <span className="persona-resolved-label">Resolved</span>
                      )}
                    </div>

                    <div
                      className="persona-excerpt"
                      onClick={handleExcerptClick}
                    >
                      “{c.excerpt}”
                    </div>

                    <div className="persona-comment-body">
                      <strong>Comment:</strong> {c.comment}
                    </div>

                    <div className="persona-suggestion">
                      <strong>Suggestion:</strong> {c.suggestion}
                    </div>

                    <div className="persona-comment-actions">
                      {c.status === "open" && (
                        <button
                          className="persona-action-btn"
                          onClick={() => handleResolveComment(c.id)}
                        >
                          Mark resolved
                        </button>
                      )}
                      <button
                        className="persona-action-btn secondary"
                        onClick={() => handleHideComment(c.id)}
                      >
                        Hide
                      </button>
                    </div>
                  </div>
                ))}
            </section>
          )}
        </aside>
      </main>
    </div>
  );
}

export default App;
