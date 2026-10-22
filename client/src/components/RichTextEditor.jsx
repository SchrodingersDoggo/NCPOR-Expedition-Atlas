import React, { useCallback, useRef } from 'react';
import { Bold, Italic, Underline, List, ListOrdered, Heading2 } from 'lucide-react';

// A deliberately small contentEditable-based editor — no external rich-text
// library is installed in this project, and pulling one in for a handful of
// formatting options isn't worth the dependency. Uses the browser's
// execCommand, which is deprecated but still broadly supported and is
// plenty for bold/italic/underline/headings/lists. Value is stored as HTML.
const TOOLBAR = [
  { command: 'bold', icon: Bold, label: 'Bold' },
  { command: 'italic', icon: Italic, label: 'Italic' },
  { command: 'underline', icon: Underline, label: 'Underline' },
  { command: 'formatBlock', arg: 'H2', icon: Heading2, label: 'Heading' },
  { command: 'insertUnorderedList', icon: List, label: 'Bullet list' },
  { command: 'insertOrderedList', icon: ListOrdered, label: 'Numbered list' },
];

export default function RichTextEditor({ value, onChange, placeholder }) {
  const editorRef = useRef(null);
  const initialized = useRef(false);

  // contentEditable is uncontrolled by nature — only push `value` in once,
  // on mount, so typing doesn't fight React re-renders / reset the cursor.
  const setRef = useCallback(
    (el) => {
      editorRef.current = el;
      if (el && !initialized.current) {
        el.innerHTML = value || '';
        initialized.current = true;
      }
    },
    [value]
  );

  const exec = (command, arg) => {
    editorRef.current?.focus();
    document.execCommand(command, false, arg);
    onChange(editorRef.current?.innerHTML || '');
  };

  const isEmpty = !value || value === '<br>';

  return (
    <div className="border border-slate-700 rounded-md overflow-hidden bg-[#162933]">
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-slate-700 bg-[#0f2129]">
        {TOOLBAR.map(({ command, arg, icon: Icon, label }) => (
          <button
            key={label}
            type="button"
            title={label}
            onClick={() => exec(command, arg)}
            className="p-1.5 rounded hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
          >
            <Icon className="w-4 h-4" />
          </button>
        ))}
      </div>
      <div className="relative">
        {isEmpty && placeholder && (
          <div className="absolute top-3 left-3 text-sm text-slate-500 pointer-events-none select-none">
            {placeholder}
          </div>
        )}
        <div
          ref={setRef}
          contentEditable
          suppressContentEditableWarning
          onInput={(e) => onChange(e.currentTarget.innerHTML)}
          className="min-h-[180px] max-h-[420px] overflow-y-auto px-3 py-3 text-sm text-white focus:outline-none prose-invert [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
        />
      </div>
    </div>
  );
}
