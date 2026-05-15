// Natural-language refine input — sits below the Visual Mode render and
// asks the LLM to modify the current expression based on a free-text
// instruction. Uses the tool-use loop server endpoint: sends the catalog
// index + saved columns alongside the instruction so the model can pick
// functions and reference user columns by name. If the model asks for
// clarification, the question replaces the placeholder and the next
// submission carries the conversation state back to the server.

import { useMemo, useRef, useState } from 'react';
import { Icon } from '../Icon';
import { buildLlmIndex } from '../../core/llm-index';
import type { CustomColumnDefinition } from '../../core/types';

interface Props {
  currentExpression: string;
  onApply: (newExpression: string) => void;
  /** 'rule' enforces a boolean root; 'column' allows numeric expressions. */
  kind?: 'rule' | 'column';
  /** Live saved columns — fed into the LLM index + validator. */
  availableColumns?: readonly CustomColumnDefinition[];
}

interface RefineResult {
  newExpression: string;
  humanReadable?: string;
  confidence?: number;
}

type RefineResponse =
  | { kind: 'result'; result: RefineResult }
  | { kind: 'clarification'; question: string; state: unknown };

export function RefineWithAI({
  currentExpression, onApply, kind = 'rule', availableColumns,
}: Props) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clarification, setClarification] = useState<string | null>(null);
  const stateRef = useRef<unknown | undefined>(undefined);

  const cols = availableColumns ?? [];
  const index = useMemo(() => buildLlmIndex(cols), [cols]);
  const columnDefs = useMemo(
    () => cols.map((c) => ({ id: c.id, name: c.name, expression: c.expression })),
    [cols],
  );

  const submit = async () => {
    if (!text.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/refine-expression', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentExpression,
          instruction: text.trim(),
          kind,
          index,
          columns: columnDefs,
          state: stateRef.current,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error ?? `Refine failed (${res.status})`);
      }
      const data = (await res.json()) as RefineResponse;
      if (data.kind === 'clarification') {
        stateRef.current = data.state;
        setClarification(data.question);
        setText('');
      } else {
        stateRef.current = undefined;
        setClarification(null);
        onApply(data.result.newExpression);
        setText('');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      stateRef.current = undefined;
      setClarification(null);
    } finally {
      setLoading(false);
    }
  };

  const placeholder = clarification
    ? 'answer the AI…'
    : 'e.g. show the inverse, or add a put-side check';

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-accent text-base leading-none">✦</span>
        <span className="font-mono text-[10px] text-ink-3 uppercase tracking-[0.08em]">
          refine with AI
        </span>
      </div>
      {clarification && (
        <div className="mb-2 flex items-start gap-2 bg-bg-1 border border-line rounded px-2.5 py-1.5">
          <span className="text-accent text-[11px] leading-snug pt-0.5">✦</span>
          <div className="text-[11px] text-ink leading-snug">{clarification}</div>
        </div>
      )}
      <div className="flex items-stretch gap-1.5">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); } }}
          placeholder={placeholder}
          disabled={loading}
          className="flex-1 bg-bg-1 border border-line-2 text-ink text-xs font-mono px-2.5 py-1.5 rounded outline-none focus:border-accent disabled:opacity-60"
        />
        <button
          onClick={() => void submit()}
          disabled={loading || !text.trim()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-accent text-black hover:bg-accent-hover disabled:bg-bg-3 disabled:text-ink-4 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? <span>…</span> : <Icon name="check" size={13} />}
          <span>{loading ? 'Refining' : clarification ? 'Answer' : 'Apply'}</span>
        </button>
      </div>
      {error && (
        <div className="mt-1.5 font-mono text-[10.5px] text-neg bg-pill-neg border border-pill-neg-border rounded px-2 py-1">
          {error}
        </div>
      )}
    </div>
  );
}
