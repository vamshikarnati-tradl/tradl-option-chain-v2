import { useEffect, useRef, useState } from 'react';
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
  type AIParseResult, type AITurn,
} from '../../services/aiParse';
import { loadRecent, recordRecent, type RecentEntry } from '../../services/aiHistory';
import { useAiParse } from '../../hooks/useAiParse';
import { NUMERIC_FIELDS } from '../../core/types';
import { nextUnusedHue } from '../../core/palette';
import type { CustomColumnDefinition, OptionChainRow, RuleDefinition } from '../../core/types';

interface Props {
  open: boolean;
  onClose: () => void;
  rules: RuleDefinition[];
  columns: CustomColumnDefinition[];
  rows: OptionChainRow[];
  // Symbol the user is currently viewing. Passed to /api/ai/parse so the
  // server can pick its ATM sample row for dry-run validation.
  symbol: string;
  /** Live cursor position. Used when `anchor === 'cursor'`. */
  mouse: { x: number; y: number } | null;
  /**
   * 'cursor' = follow the live cursor until the user types or hovers in
   * (current `/` shortcut behaviour). `{x,y}` = open pinned at that
   * coordinate (Ask button + Cmd+K — feels like a centered modal).
   */
  anchor: 'cursor' | { x: number; y: number };
  onApplyRule: (rule: RuleDefinition) => void;
  onApplyColumn: (col: CustomColumnDefinition) => void;
}

export function CommandPalette({
  open, onClose, rules, columns, rows, symbol, mouse, anchor, onApplyRule, onApplyColumn,
}: Props) {
  const [input, setInput] = useState('');
  const [editingJson, setEditingJson] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentEntry[]>(() => loadRecent());
  const [refineInput, setRefineInput] = useState('');
  const [turns, setTurns] = useState<AITurn[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // The text that produced the currently-displayed result. Push this into
  // `turns` when the user submits a refine so the LLM sees the prior question.
  const lastInputRef = useRef('');

  // Keep the sheet mounted briefly after `open` flips false so the slide-down
  // exit animation can play. `entered` controls the transform/opacity classes
  // for the enter and exit transitions on mobile (and a soft fade on desktop).
  const [shouldRender, setShouldRender] = useState(open);
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    if (open) {
      setShouldRender(true);
      // Double RAF — single RAF can fire before the browser paints the
      // initial `translate-y-full` state, so the transition would have
      // nothing to animate from. RAF1 ensures the initial paint happens;
      // RAF2 then flips `entered=true` so the transition kicks in cleanly.
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
  const status: Status =
    parse.isPending ? 'parsing' :
    parse.isError ? 'error' :
    parse.isSuccess ? 'preview' :
    'idle';
  const result: AIParseResult | null = parse.data ?? null;
  const error = parse.error ? errorMessage(parse.error) : null;

  const position = usePalettePosition({ open, anchor, mouse, rootRef, inputLength: input.length });

  // Reset every open
  useEffect(() => {
    if (open) {
      setInput('');
      setEditingJson(null);
      setRecent(loadRecent());
      setRefineInput('');
      setTurns([]);
      lastInputRef.current = '';
      parse.reset();
      requestAnimationFrame(() => inputRef.current?.focus());
    }
    // intentionally only on `open` — `parse` is stable per render and resetting
    // on every render would prevent results from rendering.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Click-outside-to-close. Mounted on next tick so the keypress that
  // opened the palette doesn't immediately close it via mousedown bubbling.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    const t = window.setTimeout(() => window.addEventListener('mousedown', onDown), 0);
    return () => { window.clearTimeout(t); window.removeEventListener('mousedown', onDown); };
  }, [open, onClose]);

  // Esc to close (global, even if a child stole focus)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Editing the input invalidates the preview/error so users don't
  // accidentally Enter-apply something stale.
  useEffect(() => {
    if (open && (parse.isSuccess || parse.isError)) parse.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  const submit = (text?: string) => {
    const trimmed = (text ?? input).trim();
    if (!trimmed || parse.isPending) return;
    if (text !== undefined && text !== input) setInput(text);
    // Fresh query → drop any accumulated turns so the LLM doesn't bleed
    // context from the previous question into a different one.
    setTurns([]);
    setRefineInput('');
    lastInputRef.current = trimmed;
    parse.mutate({
      input: trimmed,
      availableFields: [...NUMERIC_FIELDS],
      existingRules: rules.map((r) => r.name),
      existingColumns: columns.map((c) => c.name),
      symbol,
      history: [],
    });
  };

  const submitRefine = () => {
    const trimmed = refineInput.trim();
    if (!trimmed || parse.isPending || !result) return;
    const nextTurns: AITurn[] = [
      ...turns,
      { userText: lastInputRef.current, assistantJson: JSON.stringify(result) },
    ].slice(-4);
    setTurns(nextTurns);
    lastInputRef.current = trimmed;
    setRefineInput('');
    parse.mutate({
      input: trimmed,
      availableFields: [...NUMERIC_FIELDS],
      existingRules: rules.map((r) => r.name),
      existingColumns: columns.map((c) => c.name),
      symbol,
      history: nextTurns,
    });
  };

  const apply = (intent: 'rule' | 'column', editedJson?: string) => {
    if (!result && !editedJson) return;
    try {
      const data = editedJson ? JSON.parse(editedJson) : result;
      if (intent === 'rule' && data?.rule) {
        const hue = nextUnusedHue(rules.map((r) => r.style.hue));
        const built = ruleFromAi(data.rule, hue);
        onApplyRule(built);
        setRecent(recordRecent({ query: input.trim(), intent: 'rule', name: built.name }));
      } else if (intent === 'column' && data?.column) {
        const built = columnFromAi(data.column);
        onApplyColumn(built);
        setRecent(recordRecent({ query: input.trim(), intent: 'column', name: built.name }));
      }
      setTurns([]);
      setRefineInput('');
      lastInputRef.current = '';
      onClose();
    } catch (e) {
      // Surface JSON parse failure inline by feeding it through the mutation
      // error channel — the body switchboard will show ErrorBody.
      console.error('apply failed', e);
    }
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    if (status === 'preview' && result) {
      if (result.intent === 'rule') apply('rule');
      else if (result.intent === 'column') apply('column');
      // ambiguous → click an option
      return;
    }
    submit();
  };

  // What the footer "↵ apply" hint should say in the current state
  const applyLabel =
    status === 'preview' && result
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
  // Mobile: bottom-anchored sheet — slides up from where the BottomBar's Ask
  // button sits, leaves a peek of the table at the top, top corners rounded.
  // Desktop: free-floating panel anchored at cursor or pinned coordinate;
  // gets a soft fade so it doesn't snap into existence at the cursor.
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
      {/* Input row */}
      <div className="flex items-center gap-2.5 px-4 h-[52px] border-b border-line shrink-0">
        <span className="text-accent text-base leading-none">✦</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder="describe a rule or column…"
          className="flex-1 bg-transparent border-0 outline-none focus:outline-none focus:ring-0 text-ink text-[14px] placeholder:text-ink-3"
        />
        {status === 'parsing' && <ParsingDots />}
        <Kbd className="hidden md:inline-block">esc</Kbd>
      </div>

      {/* Body — scrollable middle */}
      <div className="flex-1 overflow-y-auto">
        {status === 'idle' && (
          <IdleBody recent={recent} onPick={(s) => submit(s)} onPickRecent={(e) => submit(e.query)} />
        )}
        {status === 'parsing' && <ParsingBody />}
        {status === 'error' && <ErrorBody message={error ?? 'Unknown error'} onPick={(s) => submit(s)} />}
        {status === 'preview' && result && editingJson === null && (
          <PreviewBody
            result={result}
            rows={rows}
            onApply={apply}
            onEditJson={() => setEditingJson(JSON.stringify(result, null, 2))}
            onPickOption={(opt) => {
              const hint = opt.intent === 'rule' ? 'highlight ' : 'add a column for ';
              submit(hint + input);
            }}
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

      {/* Footer */}
      <div className="flex items-center justify-between px-4 h-9 border-t border-line bg-bg-1 shrink-0">
        {/* Keyboard shortcuts — desktop only (mobile has no esc/cmd keys) */}
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
          <span>haiku · structured</span>
        </div>
      </div>
    </div>
    </>
  );
}

function errorMessage(e: unknown): string {
  if (e instanceof AIParseError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
