import { useEffect, useMemo, useRef, useState } from 'react';
import { Kbd } from '../atoms';
import { IdleBody } from './IdleBody';
import { ParsingBody } from './ParsingBody';
import { ErrorBody } from './ErrorBody';
import { PreviewBody } from './PreviewBody';
import { EditJsonBody } from './EditJsonBody';
import { ParsingDots } from './atoms';
import { usePalettePosition } from './usePalettePosition';
import { PAL_W, type Status } from './types';
import {
  AIParseError, columnFromAi, ruleFromAi,
  type AIParseResult, type AmbiguousOption,
  type ConversationState,
} from '../../services/aiParse';
import { loadRecent, recordRecent, type RecentEntry } from '../../services/aiHistory';
import { useAiParse } from '../../hooks/useAiParse';
import { buildLlmIndex } from '../../core/llm-index';
import { nextUnusedHue } from '../../core/palette';
import type { CustomColumnDefinition, OptionChainRow, RuleDefinition } from '../../core/types';

interface Props {
  open: boolean;
  onClose: () => void;
  rules: RuleDefinition[];
  columns: CustomColumnDefinition[];
  rows: OptionChainRow[];
  symbol: string;
  mouse: { x: number; y: number } | null;
  anchor: 'cursor' | { x: number; y: number };
  onApplyRule: (rule: RuleDefinition) => void;
  onApplyColumn: (col: CustomColumnDefinition) => void;
}

// Local UI status. 'preview' is the only state that holds a result; the
// 'clarification' state holds a model question and an opaque conversation
// state the next submit echoes back to the server.
type PaletteStatus = Status | 'clarification';

interface ClarificationTurn {
  userText: string;
  question: string;
}

export function CommandPalette({
  open, onClose, rules, columns, rows, symbol, mouse, anchor, onApplyRule, onApplyColumn,
}: Props) {
  const [input, setInput] = useState('');
  const [editingJson, setEditingJson] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentEntry[]>(() => loadRecent());
  const [refineInput, setRefineInput] = useState('');
  // The model's last clarifying question + the conversation state we echo
  // back on the next submit. Reset when a fresh query starts.
  const [clarification, setClarification] = useState<ClarificationTurn | null>(null);
  const conversationRef = useRef<ConversationState | undefined>(undefined);
  // A short transcript of prior user turns shown above a clarification, so
  // the user remembers what they asked.
  const [transcript, setTranscript] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const [shouldRender, setShouldRender] = useState(open);
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    if (open) {
      setShouldRender(true);
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setEntered(true));
      });
      return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
    }
    setEntered(false);
    const t = window.setTimeout(() => setShouldRender(false), 220);
    return () => window.clearTimeout(t);
  }, [open]);

  const parse = useAiParse();
  const data = parse.data ?? null;
  const result: AIParseResult | null = data?.kind === 'result' ? data.result : null;

  const status: PaletteStatus =
    parse.isPending ? 'parsing' :
    parse.isError ? 'error' :
    clarification ? 'clarification' :
    result ? 'preview' :
    'idle';
  const error = parse.error ? errorMessage(parse.error) : null;

  const position = usePalettePosition({ open, anchor, mouse, rootRef, inputLength: input.length });

  // Index sent to the LLM is recomputed every render off the live columns
  // — cheap (pure function over the catalog + columns array).
  const index = useMemo(() => buildLlmIndex(columns), [columns]);
  const columnDefs = useMemo(
    () => columns.map((c) => ({ id: c.id, name: c.name, expression: c.expression })),
    [columns],
  );

  // ─── Lifecycle ───
  useEffect(() => {
    if (open) {
      setInput('');
      setEditingJson(null);
      setRecent(loadRecent());
      setRefineInput('');
      setClarification(null);
      setTranscript([]);
      conversationRef.current = undefined;
      parse.reset();
      requestAnimationFrame(() => inputRef.current?.focus());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    const t = window.setTimeout(() => window.addEventListener('mousedown', onDown), 0);
    return () => { window.clearTimeout(t); window.removeEventListener('mousedown', onDown); };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Editing the input invalidates the preview/error/clarification.
  useEffect(() => {
    if (!open) return;
    if (parse.isSuccess || parse.isError) parse.reset();
    if (clarification) setClarification(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  // After a successful response, update clarification + transcript state.
  useEffect(() => {
    if (!data) return;
    if (data.kind === 'clarification') {
      conversationRef.current = data.state;
      setClarification({ userText: lastSubmissionRef.current, question: data.question });
      setTranscript((t) => [...t, lastSubmissionRef.current]);
    } else {
      // result — preserve the transcript so multi-turn refinements still see
      // the prior questions, but drop the clarification UI.
      setClarification(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // What text was last submitted (kept in a ref so the data-effect above
  // can tag it onto the clarification turn without re-rendering).
  const lastSubmissionRef = useRef('');

  // ─── Submit helpers ───

  const submitFresh = (text?: string) => {
    const trimmed = (text ?? input).trim();
    if (!trimmed || parse.isPending) return;
    if (text !== undefined && text !== input) setInput(text);
    setClarification(null);
    setTranscript([]);
    setRefineInput('');
    conversationRef.current = undefined;
    lastSubmissionRef.current = trimmed;
    parse.mutate({
      input: trimmed,
      index,
      columns: columnDefs,
      existingRules: rules.map((r) => r.name),
      symbol,
    });
  };

  const submitFollowup = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || parse.isPending) return;
    lastSubmissionRef.current = trimmed;
    setClarification(null);
    parse.mutate({
      input: trimmed,
      index,
      columns: columnDefs,
      existingRules: rules.map((r) => r.name),
      symbol,
      state: conversationRef.current,
    });
  };

  const submitRefine = () => {
    const trimmed = refineInput.trim();
    if (!trimmed) return;
    setRefineInput('');
    submitFollowup(trimmed);
  };

  const submitOptionPick = (opt: AmbiguousOption) => {
    if (!result || parse.isPending) return;
    const followup = `${opt.label}: ${opt.description}`;
    setRefineInput('');
    submitFollowup(followup);
  };

  const submitClarificationAnswer = (answer: string) => {
    submitFollowup(answer);
  };

  // ─── Apply ───
  const apply = (intent: 'rule' | 'column', editedJson?: string) => {
    if (!result && !editedJson) return;
    try {
      const data = editedJson ? JSON.parse(editedJson) : result;
      if (intent === 'rule' && data?.rule) {
        const hue = nextUnusedHue(rules.map((r) => r.hue));
        const built = ruleFromAi(data.rule, hue);
        onApplyRule(built);
        setRecent(recordRecent({ query: input.trim(), intent: 'rule', name: built.name }));
      } else if (intent === 'column' && data?.column) {
        const built = columnFromAi(data.column);
        onApplyColumn(built);
        setRecent(recordRecent({ query: input.trim(), intent: 'column', name: built.name }));
      }
      setClarification(null);
      setTranscript([]);
      conversationRef.current = undefined;
      setRefineInput('');
      onClose();
    } catch (e) {
      console.error('apply failed', e);
    }
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    if (status === 'clarification') {
      submitClarificationAnswer(input);
      setInput('');
      return;
    }
    if (status === 'preview' && result) {
      if (result.intent === 'rule') apply('rule');
      else if (result.intent === 'column') apply('column');
      return;
    }
    submitFresh();
  };

  const applyLabel =
    status === 'clarification' ? 'answer'
      : status === 'preview' && result
        ? result.intent === 'rule' ? 'apply rule'
          : result.intent === 'column' ? 'add column'
            : 'pick an option'
        : input.trim() ? 'parse'
          : '—';

  if (!shouldRender) return null;

  const wrapStyle: React.CSSProperties = position.isMobile
    ? { paddingBottom: 'env(safe-area-inset-bottom)' }
    : {
        left: position.left,
        top: position.top,
        width: PAL_W,
        maxHeight: '72vh',
        transition: position.frozen ? 'none' : 'left 80ms ease-out, top 80ms ease-out',
      };
  const wrapClass = position.isMobile
    ? `fixed z-[2000] left-0 right-0 bottom-0 max-h-[85vh] bg-bg-1 border-t border-x border-line-2 rounded-t-xl shadow-[0_-12px_48px_rgba(0,0,0,0.6)] overflow-hidden flex flex-col transition-transform duration-200 ease-out ${entered ? 'translate-y-0' : 'translate-y-full'}`
    : `fixed z-[2000] bg-bg-1 border border-line-2 rounded-xl shadow-[0_24px_64px_rgba(0,0,0,0.7)] overflow-hidden flex flex-col transition-opacity duration-150 ${entered ? 'opacity-100' : 'opacity-0'}`;

  return (
    <>
      {position.isMobile && (
        <div
          className={`fixed inset-0 z-[1999] bg-black/55 backdrop-blur-sm transition-opacity duration-200 ${entered ? 'opacity-100' : 'opacity-0'}`}
          onMouseDown={onClose}
        />
      )}
    <div
      ref={rootRef}
      style={wrapStyle}
      className={wrapClass}
      onMouseEnter={position.freezeAtCurrentRect}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {position.isMobile && (
        <div className="flex justify-center pt-2 pb-1 shrink-0" onClick={onClose}>
          <span className="block w-10 h-1 rounded-full bg-line-2" />
        </div>
      )}

      <div className="flex items-center gap-2.5 px-4 h-[52px] border-b border-line shrink-0">
        <span className="text-accent text-base leading-none">✦</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder={
            status === 'clarification'
              ? 'answer the AI…'
              : 'describe a rule or column…'
          }
          className="flex-1 bg-transparent border-0 outline-none focus:outline-none focus:ring-0 text-ink text-[14px] placeholder:text-ink-3"
        />
        {status === 'parsing' && <ParsingDots />}
        <Kbd className="hidden md:inline-block">esc</Kbd>
      </div>

      <div className="flex-1 overflow-y-auto">
        {status === 'idle' && (
          <IdleBody recent={recent} onPick={(s) => submitFresh(s)} onPickRecent={(e) => submitFresh(e.query)} />
        )}
        {status === 'parsing' && <ParsingBody />}
        {status === 'error' && <ErrorBody message={error ?? 'Unknown error'} onPick={(s) => submitFresh(s)} />}
        {status === 'clarification' && clarification && (
          <ClarificationBody
            transcript={transcript}
            question={clarification.question}
            placeholder={input}
          />
        )}
        {status === 'preview' && result && editingJson === null && (
          <PreviewBody
            result={result}
            rows={rows}
            columns={columns}
            onApply={apply}
            onEditJson={() => setEditingJson(JSON.stringify(result, null, 2))}
            onPickOption={submitOptionPick}
            onRephrase={() => { inputRef.current?.focus(); inputRef.current?.select(); }}
            refineValue={refineInput}
            onRefineChange={setRefineInput}
            onRefineSubmit={submitRefine}
            isRefining={parse.isPending}
          />
        )}
        {status === 'preview' && result && editingJson !== null && (
          <EditJsonBody
            json={editingJson}
            onChange={setEditingJson}
            onCancel={() => setEditingJson(null)}
            onApply={() => {
              try {
                const parsed = JSON.parse(editingJson);
                apply(parsed.intent, editingJson);
              } catch (e) {
                console.error('invalid JSON', e);
              }
            }}
          />
        )}
      </div>

      <div className="flex items-center justify-between px-4 h-9 border-t border-line bg-bg-1 shrink-0">
        <div className="hidden md:flex items-center gap-3 font-mono text-[10px] text-ink-3 uppercase tracking-[0.08em]">
          <span className="inline-flex items-center gap-1">
            <Kbd size="xs">↵</Kbd> {applyLabel}
          </span>
          <span className="inline-flex items-center gap-1">
            <Kbd size="xs">esc</Kbd> close
          </span>
        </div>
        <div className="font-mono text-[10px] text-ink-4 inline-flex items-center gap-1.5 ml-auto">
          <span className="text-accent">✦</span>
          <span>haiku · tool-use</span>
        </div>
      </div>
    </div>
    </>
  );
}

function ClarificationBody({
  transcript, question,
}: {
  transcript: string[];
  question: string;
  placeholder: string;
}) {
  return (
    <div className="px-4 py-4 border-t border-line space-y-3">
      {transcript.length > 0 && (
        <div className="space-y-1.5">
          {transcript.map((t, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="font-mono text-[10px] text-ink-3 uppercase tracking-[0.08em] shrink-0 pt-0.5">you</span>
              <span className="text-[12px] text-ink-2">{t}</span>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-start gap-2 bg-bg-2 border border-line rounded-lg p-3">
        <span className="text-accent text-sm leading-none pt-0.5">✦</span>
        <div className="flex-1">
          <div className="font-mono text-[10px] text-ink-3 uppercase tracking-[0.08em] mb-1">AI asks</div>
          <div className="text-[12.5px] text-ink leading-snug">{question}</div>
        </div>
      </div>
      <div className="text-[11px] text-ink-3 italic">
        Type your answer above and press ↵ to continue.
      </div>
    </div>
  );
}

function errorMessage(e: unknown): string {
  if (e instanceof AIParseError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
