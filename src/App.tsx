import { useState } from "react";
import "./App.css";

function App() {
  const [draft, setDraft] = useState("");
  const [activeTool, setActiveTool] = useState<string | null>(null);

  const handleToolClick = (tool: string) => {
    setActiveTool(tool);
  };

  return (
    <div className="app-root">
      {/* 顶部栏 */}
      <header className="top-bar">
        <div className="top-bar-left">
          <span className="app-name">Plotania-lite</span>
        </div>
        <div className="top-bar-right">
          <input
            className="doc-title"
            placeholder="Untitled story"
          />
          <span className="save-status">Saved</span>
        </div>
      </header>

      {/* 主体：编辑区 + 侧边栏 */}
      <main className="main-layout">
        {/* 编辑器区域 */}
        <section className="editor-section">
          <div className="editor-header">
            <h2>Editor</h2>
            <p className="editor-subtitle">
              Write your story here. AI tools will appear above the text.
            </p>
          </div>

          {/* 工具栏（现在先固定显示，之后再做“选中文本时浮出”的效果） */}
          <div className="toolbar">
            <button onClick={() => handleToolClick("rewrite")}>
              Rewrite for clarity
            </button>
            <button onClick={() => handleToolClick("expand")}>Expand</button>
            <button onClick={() => handleToolClick("shorten")}>Shorten</button>
            <button onClick={() => handleToolClick("tone")}>
              Adjust tone
            </button>
          </div>

          {/* 占位编辑器：后面可以用 TipTap 替换，现在先用 textarea */}
          <textarea
            className="editor-textarea"
            placeholder="Once upon a time..."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </section>

        {/* 右侧 Sidebar：先占位，后面放虚拟读者、统计信息 */}
        <aside className="sidebar">
          <h3>Sidebar</h3>
          <div className="sidebar-block">
            <h4>Virtual readers (coming soon)</h4>
            <p className="sidebar-text">
              This area will show feedback from different reader personas,
              such as a ruthless reviewer or an emotional reader.
            </p>
          </div>
          <div className="sidebar-block">
            <h4>AI vs Human (coming soon)</h4>
            <p className="sidebar-text">
              Here we will display the percentage of text written by you vs.
              suggested by the AI.
            </p>
          </div>
        </aside>
      </main>

      {/* 底部：AI 建议对比区（A3 的占位） */}
      <section className="suggestion-panel">
        <h3>AI suggestion (placeholder)</h3>
        {activeTool ? (
          <p>
            You clicked <strong>{activeTool}</strong>. In the real system this
            panel will show the AI&#39;s rewritten version side-by-side with
            your original text, and let you accept or dismiss it.
          </p>
        ) : (
          <p>Choose a tool above to see how suggestions will appear here.</p>
        )}
      </section>
    </div>
  );
}

export default App;
