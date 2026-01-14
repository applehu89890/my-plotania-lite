// EditorWithToolbar.tsx
import React, { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import { Mark } from "@tiptap/core";

/**
 * 自定义 Mark：用于标记 AI 插入的文本，渲染成带 .ai-text class 的 span
 */
const AIText = Mark.create({
  name: "aiText",

  parseHTML() {
    return [
      {
        tag: 'span[data-ai="true"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      {
        ...HTMLAttributes,
        "data-ai": "true",
        class: (HTMLAttributes.class || "") + " ai-text",
      },
      0,
    ];
  },
});

/**
 * props:
 * - onChange(text: string): 每次内容更新时，把纯文本抛给父组件
 * - onEditorReady?(editor): 把 TipTap editor 实例传给父组件
 * - showAIOrigins?: boolean  是否显示 AI 高亮（C2: Show AI origins）
 */
const EditorWithToolbar = ({
  onChange,
  onEditorReady,
  showAIOrigins = true,
}) => {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      TextAlign.configure({
        types: ["heading", "paragraph"],
      }),
      AIText, // ✅ 加入 AI 文本标记扩展
    ],
    content: "<p>Start writing your story here...</p>",
    onUpdate({ editor }) {
      const text = editor.getText();
      if (onChange) {
        onChange(text);
      }
    },
  });

  // 初始化完成后，传出 editor 实例，并触发一次 onChange
  useEffect(() => {
    if (!editor) return;

    if (onEditorReady) {
      onEditorReady(editor);
    }

    if (onChange) {
      const initialText = editor.getText();
      onChange(initialText);
    }
  }, [editor, onEditorReady, onChange]);

  if (!editor) return null;

  return (
    <div
      className={
        "editor-wrapper " + (showAIOrigins ? "" : "ai-origins-hidden")
      }
    >
      <div className="toolbar">
        <button onClick={() => editor.chain().focus().undo().run()}>↶</button>
        <button onClick={() => editor.chain().focus().redo().run()}>↷</button>

        <span className="toolbar-divider" />

        <button
          className={editor.isActive("paragraph") ? "active" : ""}
          onClick={() => editor.chain().focus().setParagraph().run()}
        >
          P
        </button>
        <button
          className={editor.isActive("heading", { level: 1 }) ? "active" : ""}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 1 }).run()
          }
        >
          H1
        </button>
        <button
          className={editor.isActive("heading", { level: 2 }) ? "active" : ""}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
        >
          H2
        </button>

        <span className="toolbar-divider" />

        <button
          className={editor.isActive("bold") ? "active" : ""}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          B
        </button>
        <button
          className={editor.isActive("italic") ? "active" : ""}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          I
        </button>
        <button
          className={editor.isActive("strike") ? "active" : ""}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          S
        </button>

        <span className="toolbar-divider" />

        <button
          className={editor.isActive("bulletList") ? "active" : ""}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          • List
        </button>
        <button
          className={editor.isActive("orderedList") ? "active" : ""}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          1. List
        </button>

        <span className="toolbar-divider" />

        <button
          className={editor.isActive({ textAlign: "left" }) ? "active" : ""}
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
        >
          ⬅
        </button>
        <button
          className={editor.isActive({ textAlign: "center" }) ? "active" : ""}
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
        >
          ⬌
        </button>
        <button
          className={editor.isActive({ textAlign: "right" }) ? "active" : ""}
          onClick={() => editor.chain().focus().setTextAlign("right").run()}
        >
          ➡
        </button>
      </div>

      <div className="editor-content">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
};

export default EditorWithToolbar;
