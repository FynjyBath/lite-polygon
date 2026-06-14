import React, { useRef } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import { useTheme } from '../App';

export function langFromSourceType(sourceType?: string): string {
  const s = (sourceType ?? '').toLowerCase();
  if (s.includes('cpp') || s.includes('g++') || s.includes('c++') || s.startsWith('h.')) return 'cpp';
  if (s.includes('pypy') || s.includes('python')) return 'python';
  if (s.includes('java')) return 'java';
  if (s.includes('pas')) return 'pascal';
  if (s.includes('kotlin')) return 'kotlin';
  if (s.includes('csharp') || s.includes('c#')) return 'csharp';
  if (s.includes('js') || s.includes('node')) return 'javascript';
  return 'plaintext';
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  language?: string;       // explicit monaco language id
  sourceType?: string;     // or derive from a Polygon source type
  height?: number | string;
  readOnly?: boolean;
  onSave?: () => void;     // bound to Ctrl/Cmd+S
}

/**
 * Reusable Monaco code editor. Theme follows the app theme; Ctrl/Cmd+S calls
 * `onSave` instead of the browser save dialog.
 */
export default function CodeEditor({ value, onChange, language, sourceType, height = 420, readOnly, onSave }: Props) {
  const { theme } = useTheme();
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const handleMount: OnMount = (editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSaveRef.current?.();
    });
  };

  return (
    <div style={{ border: '1px solid var(--border, #ccc)', borderRadius: 4, overflow: 'hidden' }}>
      <Editor
        height={height}
        language={language ?? langFromSourceType(sourceType)}
        theme={theme === 'dark' ? 'vs-dark' : 'vs'}
        value={value}
        onChange={v => onChange(v ?? '')}
        onMount={handleMount}
        options={{
          readOnly,
          fontSize: 13,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 4,
          renderWhitespace: 'selection',
          fontFamily: '"Fira Code", "Consolas", monospace',
        }}
      />
    </div>
  );
}
