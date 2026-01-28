// App.tsx
import { useEffect, useRef, useState } from "react";
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
  /* ---------------- Document IDs for logging ---------------- */
  // sessionId is handled inside logging.ts via /api/session/start + localStorage
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

  /* ---------------- One-time: session_start + page_view ---------------- */

  const didBootLogRef = useRef(false);
  useEffect(() => {
    if (didBootLogRef.current) return;
    didBootLogRef.current = true;

    // sessionId handled in logging.ts; this call will create session if missing
    logEvent({
      documentId,
      eventType: "session_start",
      payloadJson: { userAgent: navigator.userAgent, referrer: document.referrer },
    });

    logEvent({
      documentId,
      eventType: "page_view",
      payloadJson: { path: window.location.pathname },
    });
  }, [documentId]);

  /* ---------------- Utility: Save ---------------- */

  const handleManualSave = () => {
    setSaveStatus("saving");

    logEvent({
      documentId,
      eventType: "save_click",
      docLength: editorText.length,
      payloadJson: {
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
    let payload: any = null;

    try {
      setLoadingAction(mode);

      // 1) tool_click
      logEvent({
        documentId,
        eventType: "tool_click",
        toolName: mode,
        docLength: editorText.length,
      });

      payload = buildTransformPayload(mode);
      if (!payload) {
        setImproveText("Editor is not ready yet. Please try again.");
        // tool_error (editor not ready)
        logEvent({
          documentId,
          eventType: "tool_error",
          toolName: mode,
          docLength: editorText.length,
          payloadJson: { message: "editor_not_ready" },
        });
        return;
      }

      // ✅ "What's working": show current action + selected text
      const excerpt = clip(payload.selectedText, 140);
      setWorkingText(
        `Running: ${modeToEnglish(mode)} (${MODE_LABEL[mode]}). Selected: “${excerpt}”`
      );
      setImproveText("Generating a suggestion…");

      // 2) tool_request
      logEvent({
        documentId,
        eventType: "tool_request",
        toolName: mode,
        selectionStart: payload.from,
        selectionEnd: payload.to,
        docLength: payload.fullText.length,
        payloadJson: {
          selectedTextLength: payload.selectedText.length,
          selectedIsFullDoc: payload.selectedText.trim() === payload.fullText.trim(),
        },
      });

      // ✅ frontend calls backend; backend calls OpenAI
      const API_BASE = import.meta.env.VITE_API_BASE;
      const res = await fetch(`${API_BASE}/llm/transform`, {
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
        // 4) tool_error
        logEvent({
          documentId,
          eventType: "tool_error",
          toolName: mode,
          selectionStart: payload.from,
          selectionEnd: payload.to,
          docLength: payload.fullText.length,
          payloadJson: { message: `backend_${res.status}`, detail: raw.slice(0, 500) },
        });
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

      // 3) tool_response
      const originalWordCount = payload.selectedText.trim().split(/\s+/).filter(Boolean).length;
      const suggestionWordCount = aiText.trim().split(/\s+/).filter(Boolean).length;
      logEvent({
        documentId,
        eventType: "tool_response",
        toolName: mode,
        selectionStart: payload.from,
        selectionEnd: payload.to,
        docLength: payload.fullText.length,
        payloadJson: {
          wordDiff: suggestionWordCount - originalWordCount,
          suggestionLength: aiText.length,
        },
      });
    } catch (err: any) {
      setImproveText(`Backend call failed: ${err.message}`);
      // (tool_error already logged above on non-OK; this is a fallback)
      logEvent({
        documentId,
        eventType: "tool_error",
        toolName: mode,
        docLength: editorText.length,
        payloadJson: { message: String(err?.message || err) },
      });
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
      documentId,
      eventType: "accept_suggestion",
      toolName: mode,
      docLength: newText.length,
      payloadJson: {
        originalLength: original.length,
        suggestionLength: suggestion.length,
      },
    });
  };

  const handleDismissSuggestion = () => {
    if (aiSuggestion) {
      setWorkingText(
        `Dismissed: ${modeToEnglish(aiSuggestion.mode)} (${MODE_LABEL[aiSuggestion.mode]}). The suggestion was not applied.`
      );
      setImproveText("You can select a passage again and generate a new suggestion.");
    }

    const mode = aiSuggestion?.mode;

    setAiSuggestion(null);

    // ✅ log dismiss
    logEvent({
      documentId,
      eventType: "dismiss_suggestion",
      toolName: mode,
      docLength: editorText.length,
    });
  };

  /* ---------------- Module B: Persona Feedback (B1+B2) ---------------- */

  const handleGetFeedback = async (personaId: PersonaId) => {
    if (!editorInstance) return;

    // click
    logEvent({
      documentId,
      eventType: "persona_click_get_feedback",
      toolName: personaId,
      docLength: editorText.length,
      payloadJson: { personaId },
    });

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
      logEvent({
        documentId,
        eventType: "persona_feedback_error",
        toolName: personaId,
        docLength: editorText.length,
        payloadJson: { personaId, message: "empty_text" },
      });
      return;
    }

    setLastFeedbackSelection({ from: feedbackFrom, to: feedbackTo });

    // request
    logEvent({
      documentId,
      eventType: "persona_feedback_request",
      toolName: personaId,
      selectionStart: feedbackFrom,
      selectionEnd: feedbackTo,
      docLength: editor.state.doc.textBetween(0, fullSize, "\n").length,
      payloadJson: {
        personaId,
        excerptLength: selectedPassage.length,
      },
    });

    try {
      setPersonaLoadingId(personaId);
      const API_BASE = import.meta.env.VITE_API_BASE;
      const res = await fetch(`${API_BASE}/llm/feedback`, {
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
        logEvent({
          documentId,
          eventType: "persona_feedback_error",
          toolName: personaId,
          docLength: editorText.length,
          payloadJson: { personaId, message: `backend_${res.status}`, detail: raw.slice(0, 500) },
        });
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

      // success
      logEvent({
        documentId,
        eventType: "persona_feedback_success",
        toolName: personaId,
        docLength: editor.state.doc.textBetween(0, fullSize, "\n").length,
        payloadJson: { personaId, count: comments.length },
      });

      // keep your old event name too (optional, can remove)
      logEvent({
        documentId,
        eventType: "persona_feedback_received",
        toolName: personaId,
        docLength: editor.state.doc.textBetween(0, fullSize, "\n").length,
        payloadJson: {
          commentsCount: comments.length,
        },
      });
    } catch (err: any) {
      console.error("Persona feedback error:", err);
      logEvent({
        documentId,
        eventType: "persona_feedback_error",
        toolName: personaId,
        docLength: editorText.length,
        payloadJson: { personaId, message: String(err?.message || err) },
      });
    } finally {
      setPersonaLoadingId(null);
    }
  };

  /** click excerpt to highlight remembered selection */
  const handleExcerptClick = (personaId: PersonaId, commentId: string) => {
    if (!editorInstance || !lastFeedbackSelection) return;

    const { from, to } = lastFeedbackSelection;

    editorInstance.chain().focus().setTextSelection({ from, to }).run();

    logEvent({
      documentId,
      eventType: "persona_highlight_excerpt",
      toolName: personaId,
      docLength: editorInstance.getText().length,
      payloadJson: { personaId, commentId, from, to },
    });
  };

  /** Mark resolved / Hide */

  const handleResolveComment = (personaId: PersonaId, id: string) => {
    setPersonaComments((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status: "resolved" } : c))
    );

    logEvent({
      documentId,
      eventType: "persona_mark_resolved",
      toolName: personaId,
      docLength: editorText.length,
      payloadJson: { personaId, commentId: id },
    });
  };

  const handleHideComment = (personaId: PersonaId, id: string) => {
    setPersonaComments((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status: "hidden" } : c))
    );

    logEvent({
      documentId,
      eventType: "persona_hide_comment",
      toolName: personaId,
      docLength: editorText.length,
      payloadJson: { personaId, commentId: id },
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
                documentId,
                eventType: "title_change",
                docLength: editorText.length,
                payloadJson: { title: e.target.value },
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

              // NOTE: this can be chatty; keep for now, you can throttle later
              logEvent({
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
                    {aiSuggestion.suggestion.trim().split(/\s+/).filter(Boolean).length -
                      aiSuggestion.original.trim().split(/\s+/).filter(Boolean).length}
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
                  <pre className="suggestion-text">{aiSuggestion.suggestion}</pre>
                </div>
              </div>

              <div className="suggestion-actions">
                <button className="primary-btn" onClick={handleAcceptSuggestion}>
                  Replace
                </button>
                <button className="secondary-btn" onClick={handleDismissSuggestion}>
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
                  "attrib-card" + (aiPercent >= humanPercent ? " attrib-card-active" : "")
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
                  "attrib-card" + (humanPercent > aiPercent ? " attrib-card-active" : "")
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
                    documentId,
                    eventType: "toggle_ai_origins",
                    docLength: editorText.length,
                    payloadJson: { value: e.target.checked },
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
                      <span className="persona-pill">{getPersonaName(c.persona)}</span>
                      {c.status === "resolved" && (
                        <span className="persona-resolved-label">Resolved</span>
                      )}
                    </div>

                    <div
                      className="persona-excerpt"
                      onClick={() => handleExcerptClick(c.persona, c.id)}
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
                          onClick={() => handleResolveComment(c.persona, c.id)}
                        >
                          Mark resolved
                        </button>
                      )}
                      <button
                        className="persona-action-btn secondary"
                        onClick={() => handleHideComment(c.persona, c.id)}
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
