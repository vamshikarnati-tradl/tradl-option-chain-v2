import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtNum } from '../utils/format';
import {
  AIParseError, columnFromAi, parseNaturalLanguage, ruleFromAi,
  type AIParseResult, type AmbiguousOption,
} from '../services/aiParse';
import { dryRunColumn, dryRunRule, type DryRunRule, type ColumnSample } from '../services/aiPreview';
import { loadRecent, recordRecent, type RecentEntry } from '../services/aiHistory';
import type { CustomColumnDefinition, OptionChainRow, RuleDefinition } from '../core/types';
import { NUMERIC_FIELDS } from '../core/types';
import { nextUnusedHue } from '../core/palette';

interface Props {
  open: boolean;
  onClose: () => void;
  rules: RuleDefinition[];
  columns: CustomColumnDefinition[];
  rows: OptionChainRow[];
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

type Status = 'idle' | 'parsing' | 'preview' | 'error';

const SUGGESTIONS = [
  'highlight strikes where put OI is more than 3× call OI',
  'add a column for straddle price',
  'show me where call IV is above 16',
  'PCR per strike as a percent',
  'flag rows with call OI buildup over 50k',
];

export function CommandPalette({
  open, onClose, rules, columns, rows, mouse, anchor, onApplyRule, onApplyColumn,
}: Props) {
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<AIParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingJson, setEditingJson] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentEntry[]>(() => loadRecent());
  // When false, palette follows the cursor (with a brief ease). Once true,
  // it locks at `frozenPos` so it doesn't drift while the user is typing or
  // clicking buttons inside it.
  const [frozen, setFrozen] = useState(false);
  const [frozenPos, setFrozenPos] = useState<{ x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Reset every open
  useEffect(() => {
    if (open) {
      setInput('');
      setStatus('idle');
      setResult(null);
      setError(null);
      setEditingJson(null);
      setRecent(loadRecent());
      // Fixed-anchor opens (Ask button, Cmd+K) start frozen at the supplied
      // coords. Cursor opens (`/`) start free and follow the mouse.
      if (anchor === 'cursor') {
        setFrozen(false);
        setFrozenPos(null);
      } else {
        setFrozen(true);
        setFrozenPos({ x: anchor.x, y: anchor.y });
      }
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      abortRef.current?.abort();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Lock position the moment the user starts typing — keyboard input
  // shouldn't make the panel slide around.
  useEffect(() => {
    if (open && input.length > 0 && !frozen && rootRef.current) {
      const r = rootRef.current.getBoundingClientRect();
      setFrozenPos({ x: r.left, y: r.top });
      setFrozen(true);
    }
  }, [open, input, frozen]);

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
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Editing the input invalidates the preview/error so users don't
  // accidentally Enter-apply something stale.
  useEffect(() => {
    if (!open) return;
    if (status === 'preview' || status === 'error') {
      setStatus('idle');
      setResult(null);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  const submit = (text?: string) => {
    const trimmed = (text ?? input).trim();
    if (!trimmed || status === 'parsing') return;
    if (text !== undefined && text !== input) setInput(text);
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setStatus('parsing');
    setError(null);
    parseNaturalLanguage({
      input: trimmed,
      availableFields: [...NUMERIC_FIELDS],
      existingRules: rules.map((r) => r.name),
      existingColumns: columns.map((c) => c.name),
      signal: ctrl.signal,
    })
      .then((r) => {
        if (ctrl.signal.aborted) return;
        setResult(r);
        setStatus('preview');
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        if (e instanceof AIParseError) setError(e.message);
        else if (e instanceof Error) setError(e.message);
        else setError(String(e));
        setStatus('error');
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
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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

  if (!open) return null;

  // Position: follow the cursor with a 16/12 px offset, clamp to viewport.
  // Once frozen (typing or pointer entered), pin to the captured position.
  const PAL_W = 460;
  const PAL_H_EST = 360;
  const margin = 12;

  let left: number;
  let top: number;
  if (frozen && frozenPos) {
    left = frozenPos.x;
    top = frozenPos.y;
  } else {
    const ax = mouse?.x ?? window.innerWidth / 2;
    const ay = mouse?.y ?? window.innerHeight / 3;
    left = ax + 16;
    if (left + PAL_W + margin > window.innerWidth) left = Math.max(margin, ax - 16 - PAL_W);
    top = ay + 12;
    if (top + PAL_H_EST + margin > window.innerHeight) top = Math.max(margin, window.innerHeight - PAL_H_EST - margin);
  }

  return (
    <div
      ref={rootRef}
      style={{
        left,
        top,
        width: PAL_W,
        maxHeight: '72vh',
        transition: frozen ? 'none' : 'left 80ms ease-out, top 80ms ease-out',
      }}
      className="fixed z-[2000] bg-bg-1 border border-line-2 rounded-xl shadow-[0_24px_64px_rgba(0,0,0,0.7)] overflow-hidden flex flex-col"
      onMouseEnter={() => {
        if (!frozen && rootRef.current) {
          const r = rootRef.current.getBoundingClientRect();
          setFrozenPos({ x: r.left, y: r.top });
          setFrozen(true);
        }
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
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
          <kbd className="font-mono text-[10px] bg-bg-3 text-ink-2 px-1.5 py-0.5 rounded border border-line-2">esc</kbd>
        </div>

        {/* Body — scrollable middle */}
        <div className="flex-1 overflow-y-auto">
          {status === 'idle' && (
            <IdleBody
              recent={recent}
              onPick={(s) => submit(s)}
              onPickRecent={(e) => submit(e.query)}
            />
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
                  setError(e instanceof Error ? e.message : String(e));
                }
              }}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 h-9 border-t border-line bg-bg-1 shrink-0">
          <div className="flex items-center gap-3 font-mono text-[10px] text-ink-3 uppercase tracking-[0.08em]">
            <span className="inline-flex items-center gap-1">
              <kbd className="bg-bg-3 px-1 py-px rounded border border-line-2 text-ink-2">↵</kbd> {applyLabel}
            </span>
            <span className="inline-flex items-center gap-1">
              <kbd className="bg-bg-3 px-1 py-px rounded border border-line-2 text-ink-2">esc</kbd> close
            </span>
          </div>
          <div className="font-mono text-[10px] text-ink-4 inline-flex items-center gap-1.5">
            <span className="text-accent">✦</span>
            <span>haiku · structured</span>
          </div>
        </div>
    </div>
  );
}

// ──────────────────────── Idle ────────────────────────

interface IdleProps {
  recent: RecentEntry[];
  onPick: (s: string) => void;
  onPickRecent: (e: RecentEntry) => void;
}

function IdleBody({ recent, onPick, onPickRecent }: IdleProps) {
  return (
    <div className="px-4 py-4">
      <div className="font-mono text-[10px] text-ink-3 uppercase tracking-[0.08em] mb-2">Try</div>
      <div className="flex flex-col gap-1">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="text-left text-[12.5px] text-ink-2 px-2.5 py-1.5 rounded hover:bg-bg-2 hover:text-ink transition-colors flex items-center gap-2 group"
          >
            <span className="text-ink-4 group-hover:text-accent transition-colors">→</span>
            <span>{s}</span>
          </button>
        ))}
      </div>
      {recent.length > 0 && (
        <>
          <div className="font-mono text-[10px] text-ink-3 uppercase tracking-[0.08em] mt-3 mb-2">Recent</div>
          <div className="flex flex-col gap-0.5">
            {recent.map((h) => (
              <button
                key={`${h.query}-${h.ts}`}
                onClick={() => onPickRecent(h)}
                className="text-left text-[11.5px] text-ink-3 px-2.5 py-1 rounded hover:bg-bg-2 hover:text-ink-2 transition-colors flex items-center gap-2"
              >
                <span className="text-ink-4">{h.intent === 'rule' ? '◆' : 'ƒ'}</span>
                <span className="truncate">{h.query}</span>
                <span className="ml-auto text-ink-4 font-mono text-[10px] truncate">{h.name}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ──────────────────────── Parsing ────────────────────────

function ParsingDots() {
  return (
    <span className="font-mono text-[10px] text-ink-3 uppercase tracking-[0.08em] inline-flex items-center gap-1.5">
      <span className="w-1 h-1 rounded-full bg-accent animate-pulse-soft" />
      <span className="w-1 h-1 rounded-full bg-accent animate-pulse-soft" style={{ animationDelay: '160ms' }} />
      <span className="w-1 h-1 rounded-full bg-accent animate-pulse-soft" style={{ animationDelay: '320ms' }} />
      <span className="ml-0.5">parsing</span>
    </span>
  );
}

function ParsingBody() {
  return (
    <div className="px-4 pt-3 pb-4 border-t border-line">
      <div className="flex items-center gap-3 text-ink-3 py-3">
        <div className="w-3.5 h-3.5 border-2 border-line-2 border-t-accent rounded-full animate-spin" />
        <span className="text-[12.5px]">parsing your intent…</span>
      </div>
    </div>
  );
}

// ──────────────────────── Error ────────────────────────

interface ErrorProps {
  message: string;
  onPick: (s: string) => void;
}

function ErrorBody({ message, onPick }: ErrorProps) {
  return (
    <div className="px-4 pt-3 pb-4 border-t border-line">
      <div className="flex items-center gap-2 mb-2.5">
        <StatePill tone="neg">! Error</StatePill>
        <span className="text-[12.5px] text-ink-2">Couldn't parse that</span>
      </div>
      <div className="text-[11.5px] text-ink-3 leading-[1.5] mb-3">
        {message}. Try one of the examples below, or rephrase using a field name like{' '}
        <span className="font-mono text-ink-2">call_oi</span> or <span className="font-mono text-ink-2">put_iv</span>.
      </div>
      <div className="flex flex-col gap-1">
        {SUGGESTIONS.slice(0, 3).map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="text-left text-[11.5px] text-ink-3 px-2.5 py-1.5 rounded hover:bg-bg-2 hover:text-ink-2 transition-colors flex items-center gap-2"
          >
            <span className="text-ink-4">→</span>
            <span>{s}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ──────────────────────── Preview ────────────────────────

interface PreviewProps {
  result: AIParseResult;
  rows: OptionChainRow[];
  onApply: (intent: 'rule' | 'column') => void;
  onEditJson: () => void;
  onPickOption: (opt: AmbiguousOption) => void;
  onRephrase: () => void;
}

function PreviewBody({ result, rows, onApply, onEditJson, onPickOption, onRephrase }: PreviewProps) {
  if (result.intent === 'ambiguous' && result.options) {
    return <AmbiguousView confidence={result.confidence} options={result.options} onPick={onPickOption} />;
  }
  if (result.intent === 'rule' && result.rule) {
    return (
      <RulePreview
        result={result}
        rows={rows}
        onApply={() => onApply('rule')}
        onEditJson={onEditJson}
        onRephrase={onRephrase}
      />
    );
  }
  if (result.intent === 'column' && result.column) {
    return (
      <ColumnPreview
        result={result}
        rows={rows}
        onApply={() => onApply('column')}
        onEditJson={onEditJson}
        onRephrase={onRephrase}
      />
    );
  }
  return null;
}

// ── Rule preview ──

function RulePreview({
  result, rows, onApply, onEditJson, onRephrase,
}: { result: AIParseResult; rows: OptionChainRow[]; onApply: () => void; onEditJson: () => void; onRephrase: () => void }) {
  const r = result.rule!;
  const isLow = result.confidence < 0.7;

  // Build a temp RuleDefinition to dry-run against current rows
  const dryRun: DryRunRule = useMemo(() => {
    const hue = 195;
    return dryRunRule(ruleFromAi(r, hue), rows);
  }, [r, rows]);

  return (
    <div className="px-4 pt-3 pb-4 border-t border-line">
      <div className="flex items-center gap-2 mb-3">
        <StatePill tone="accent">◆ Rule</StatePill>
        <span className="text-[13px] font-medium truncate">{r.name}</span>
        <span className="ml-auto"><ConfidenceBar value={result.confidence} /></span>
      </div>

      {isLow && (
        <div className="flex items-start gap-2 mb-3 bg-[hsla(45,70%,30%,0.10)] border border-[hsla(45,70%,30%,0.40)] rounded-lg px-3 py-2">
          <span className="text-[hsl(45,90%,70%)] mt-px text-[13px] leading-none">⚠</span>
          <div className="flex-1 text-[11.5px] text-[hsl(45,90%,85%)] leading-[1.5]">
            <span className="font-medium">Best guess.</span>
            <span className="text-[hsl(45,90%,75%)]"> The model wasn't fully sure. Verify the conditions below before applying — or rephrase with a specific field/threshold.</span>
          </div>
        </div>
      )}

      <div className="text-[11.5px] text-ink-2 mb-3 leading-[1.5]">{r.description}</div>

      <div className="flex flex-wrap items-center gap-1.5 mb-3 bg-bg-1 border border-line rounded-lg p-2.5">
        {r.conditions.map((c, i) => (
          <ConditionRow key={i} condition={c} logic={r.logic} isLast={i === r.conditions.length - 1} />
        ))}
      </div>

      <div className="flex items-center justify-between mb-3">
        <div className="font-mono text-[11px] text-ink-3">
          highlight on <span className="text-ink-2">{r.scope}</span>
          {dryRun.error ? (
            <span className="ml-2 text-neg">{dryRun.error}</span>
          ) : dryRun.total > 0 ? (
            <> · matches{' '}
              <span className={`font-semibold ${dryRun.matches > 0 ? 'text-pos' : 'text-ink-2'}`}>
                {dryRun.matches}
              </span>
              <span className="text-ink-2">/{dryRun.total}</span>{' '}strikes
            </>
          ) : null}
        </div>
        {!dryRun.error && dryRun.total > 0 && (
          <div className="h-1.5 w-24 bg-bg-3 rounded-full overflow-hidden">
            <div
              className="h-full bg-pos/80 transition-all"
              style={{ width: `${Math.max(2, (dryRun.matches / dryRun.total) * 100)}%` }}
            />
          </div>
        )}
      </div>

      <div className="flex gap-1.5 justify-end">
        {isLow && <GhostBtn onClick={onRephrase}>Rephrase</GhostBtn>}
        <GhostBtn onClick={onEditJson}>{'</> Edit JSON'}</GhostBtn>
        <PrimaryBtn onClick={onApply}>
          ✓ Apply rule <kbd className="font-mono text-[9px] bg-black/15 px-1 py-px rounded">↵</kbd>
        </PrimaryBtn>
      </div>
    </div>
  );
}

// ── Column preview ──

function ColumnPreview({
  result, rows, onApply, onEditJson, onRephrase,
}: { result: AIParseResult; rows: OptionChainRow[]; onApply: () => void; onEditJson: () => void; onRephrase: () => void }) {
  const c = result.column!;
  const samples: ColumnSample[] = useMemo(() => dryRunColumn(c.expression, rows), [c.expression, rows]);
  const isLow = result.confidence < 0.7;

  const fmtSample = (s: ColumnSample) => {
    if (s.value == null) return '—';
    const n = fmtNum(s.value, c.format.decimals);
    return c.format.type === 'percentage' ? `${n}%` : c.format.type === 'currency' ? `₹${n}` : n;
  };

  return (
    <div className="px-4 pt-3 pb-4 border-t border-line">
      <div className="flex items-center gap-2 mb-3">
        <StatePill tone="accent">ƒ Column</StatePill>
        <span className="text-[13px] font-medium truncate">{c.name}</span>
        <StatePill tone="neutral">{c.format.type}</StatePill>
        <span className="ml-auto"><ConfidenceBar value={result.confidence} /></span>
      </div>

      {isLow && (
        <div className="flex items-start gap-2 mb-3 bg-[hsla(45,70%,30%,0.10)] border border-[hsla(45,70%,30%,0.40)] rounded-lg px-3 py-2">
          <span className="text-[hsl(45,90%,70%)] mt-px text-[13px] leading-none">⚠</span>
          <div className="flex-1 text-[11.5px] text-[hsl(45,90%,85%)] leading-[1.5]">
            <span className="font-medium">Best guess.</span>
            <span className="text-[hsl(45,90%,75%)]"> Verify the expression before adding.</span>
          </div>
        </div>
      )}

      <code className="block bg-bg-1 border border-line rounded-lg px-3 py-2 font-mono text-[12px] text-[hsl(217,80%,82%)] mb-3 break-all">
        {c.expression}
      </code>

      {samples.length > 0 && (
        <>
          <div className="font-mono text-[10px] text-ink-3 uppercase tracking-[0.08em] mb-1.5">Sample (around ATM)</div>
          <div className="bg-bg-1 border border-line rounded-lg overflow-hidden mb-3">
            {samples.map((s, i) => (
              <div
                key={s.strikePrice}
                className={
                  'flex items-center justify-between px-3 py-1.5 font-mono text-[11.5px] tnum '
                  + (i > 0 ? 'border-t border-line ' : '')
                  + (s.isAtm ? 'bg-[hsla(45,60%,30%,0.10)]' : '')
                }
              >
                <span className="text-ink-3">strike</span>
                <span className="text-ink-2">{s.strikePrice.toLocaleString('en-IN')}</span>
                <span className="text-ink-3">→</span>
                <span className={s.value == null ? 'text-ink-4 italic' : 'text-pos'}>
                  {fmtSample(s)}
                </span>
                <span className="text-ink-4 text-[10px] w-8 text-right">{s.isAtm ? 'ATM' : ''}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="flex gap-1.5 justify-end">
        {isLow && <GhostBtn onClick={onRephrase}>Rephrase</GhostBtn>}
        <GhostBtn onClick={onEditJson}>{'</> Edit JSON'}</GhostBtn>
        <PrimaryBtn onClick={onApply}>
          ✓ Add column <kbd className="font-mono text-[9px] bg-black/15 px-1 py-px rounded">↵</kbd>
        </PrimaryBtn>
      </div>
    </div>
  );
}

// ── Ambiguous view ──

interface AmbigProps {
  confidence: number;
  options: AmbiguousOption[];
  onPick: (opt: AmbiguousOption) => void;
}

function AmbiguousView({ confidence, options, onPick }: AmbigProps) {
  return (
    <div className="px-4 pt-3 pb-4 border-t border-line">
      <div className="flex items-center gap-2 mb-3">
        <StatePill tone="warn">? Ambiguous</StatePill>
        <span className="text-[12.5px] text-ink-2">What did you mean?</span>
        <span className="ml-auto"><ConfidenceBar value={confidence} /></span>
      </div>
      <div className="flex flex-col gap-1.5">
        {options.map((opt) => (
          <button
            key={opt.label}
            onClick={() => onPick(opt)}
            className="text-left flex items-start gap-3 bg-bg-1 hover:bg-bg-2 border border-line hover:border-line-2 rounded-lg px-3 py-2.5 transition-colors"
          >
            <span className={`mt-0.5 ${opt.intent === 'rule' ? 'text-accent' : 'text-[hsl(280,70%,82%)]'}`}>
              {opt.intent === 'rule' ? '◆' : 'ƒ'}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] font-medium">{opt.label}</div>
              <div className="text-[11px] text-ink-3 leading-[1.4] mt-0.5">{opt.description}</div>
            </div>
            <span className="text-ink-3 mt-0.5">›</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Edit JSON ──

interface EditJsonProps {
  json: string;
  onChange: (v: string) => void;
  onCancel: () => void;
  onApply: () => void;
}

function EditJsonBody({ json, onChange, onCancel, onApply }: EditJsonProps) {
  const isValid = useMemo(() => { try { JSON.parse(json); return true; } catch { return false; } }, [json]);
  return (
    <div className="px-4 pt-3 pb-4 border-t border-line">
      <div className="flex items-center gap-2 mb-2.5">
        <StatePill tone="neutral">{'{ } JSON'}</StatePill>
        <span className="text-[12.5px] text-ink-2">Edit raw definition</span>
        <span className="ml-auto font-mono text-[10px] text-ink-4">power-user escape hatch</span>
      </div>
      <textarea
        value={json}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        rows={14}
        className="w-full bg-bg-1 border border-line text-[hsl(217,80%,85%)] font-mono text-[11px] leading-[1.5] px-2.5 py-2 rounded outline-none whitespace-pre-wrap resize-y focus:border-accent"
      />
      <div className="flex justify-between items-center mt-2">
        <span className={`font-mono text-[10px] ${isValid ? 'text-pos' : 'text-neg'}`}>
          {isValid ? '✓ valid JSON' : '✗ invalid JSON'}
        </span>
        <div className="flex gap-1.5">
          <GhostBtn onClick={onCancel}>Cancel</GhostBtn>
          <PrimaryBtn onClick={onApply} disabled={!isValid}>Save & apply</PrimaryBtn>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────── Atoms ────────────────────────

function StatePill({
  children, tone = 'neutral',
}: { children: React.ReactNode; tone?: 'neutral' | 'pos' | 'warn' | 'neg' | 'accent' }) {
  const map = {
    neutral: 'bg-bg-3 text-ink-2 border-line-2',
    pos: 'bg-[hsla(142,60%,30%,0.2)] text-pos border-[hsla(142,60%,30%,0.4)]',
    warn: 'bg-[hsla(45,70%,30%,0.2)] text-[hsl(45,90%,75%)] border-[hsla(45,70%,30%,0.5)]',
    neg: 'bg-[hsla(0,60%,30%,0.2)] text-neg border-[hsla(0,60%,30%,0.5)]',
    accent: 'bg-[hsla(217,80%,55%,0.18)] text-accent border-[hsla(217,80%,55%,0.4)]',
  };
  return (
    <span className={`inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.08em] px-1.5 py-0.5 rounded border ${map[tone]}`}>
      {children}
    </span>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round((value || 0) * 100);
  const tone = value >= 0.8 ? 'pos' : value >= 0.6 ? 'warn' : 'neg';
  const barColor = tone === 'pos' ? '#4ade80' : tone === 'warn' ? 'hsl(45,90%,60%)' : '#f87171';
  return (
    <div className="flex items-center gap-1.5" title={`Model confidence: ${pct}%`}>
      <div className="h-1 w-10 bg-bg-3 rounded-full overflow-hidden">
        <div className="h-full transition-all" style={{ width: `${pct}%`, background: barColor }} />
      </div>
      <span className="font-mono text-[10px] text-ink-3">{pct}%</span>
    </div>
  );
}

interface RawCondition {
  lhs: { kind: 'field' | 'expr'; field?: string; expression?: string };
  operator: string;
  rhs: { kind: 'literal' | 'field' | 'expr'; value?: number; field?: string; expression?: string };
}

// Render a single condition as a chip strip. Detects `<field> * <number>` /
// `<number> * <field>` patterns on the rhs to render as `[field] × [N]` —
// matches the showcase's purple multiplier styling.
function ConditionRow({
  condition: c, logic, isLast,
}: { condition: RawCondition; logic: 'AND' | 'OR'; isLast: boolean }) {

  const opSym = ({ gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=', neq: '≠' } as Record<string, string>)[c.operator] ?? c.operator;

  const renderLhs = () =>
    c.lhs.kind === 'field' && c.lhs.field
      ? <Chip kind="field">{c.lhs.field}</Chip>
      : <Chip kind="expr">{c.lhs.expression}</Chip>;

  const renderRhs = () => {
    if (c.rhs.kind === 'literal' && typeof c.rhs.value === 'number') {
      return <Chip kind="value">{formatNum(c.rhs.value)}</Chip>;
    }
    if (c.rhs.kind === 'field' && c.rhs.field) {
      return <Chip kind="field">{c.rhs.field}</Chip>;
    }
    if (c.rhs.kind === 'expr' && c.rhs.expression) {
      const split = splitFieldMultiplier(c.rhs.expression);
      if (split) {
        return (
          <>
            <Chip kind="mult">{formatNum(split.multiplier)}</Chip>
            <span className="font-mono text-[11px] text-ink-3">×</span>
            <Chip kind="field">{split.field}</Chip>
          </>
        );
      }
      return <Chip kind="expr">{c.rhs.expression}</Chip>;
    }
    return null;
  };

  return (
    <>
      {renderLhs()}
      <Chip kind="op">{opSym}</Chip>
      {renderRhs()}
      {!isLast && <span className="font-mono text-[10px] text-ink-4 mx-1 uppercase tracking-[0.08em]">{logic}</span>}
    </>
  );
}

function splitFieldMultiplier(expr: string): { field: string; multiplier: number } | null {
  // `field * number` or `number * field` (allow whitespace + decimals)
  const m1 = expr.trim().match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*\*\s*([\d.]+)$/);
  if (m1) return { field: m1[1], multiplier: Number(m1[2]) };
  const m2 = expr.trim().match(/^([\d.]+)\s*\*\s*([a-zA-Z_][a-zA-Z0-9_]*)$/);
  if (m2) return { field: m2[2], multiplier: Number(m2[1]) };
  return null;
}

function formatNum(n: number): string {
  if (Number.isInteger(n)) return n.toString();
  return n.toFixed(Math.min(2, (n.toString().split('.')[1] ?? '').length));
}

function Chip({
  children, kind = 'field',
}: { children: React.ReactNode; kind?: 'field' | 'op' | 'value' | 'mult' | 'expr' }) {
  const tones = {
    field: 'bg-[hsla(217,40%,40%,0.20)] text-[hsl(217,80%,80%)] border-[hsla(217,40%,40%,0.4)]',
    op: 'bg-bg-3 text-ink-2 border-line-2',
    value: 'bg-[hsla(45,60%,30%,0.25)] text-[hsl(45,90%,90%)] border-[hsla(45,60%,30%,0.5)]',
    mult: 'bg-[hsla(280,40%,40%,0.20)] text-[hsl(280,70%,90%)] border-[hsla(280,40%,40%,0.4)]',
    expr: 'bg-bg-3 text-[hsl(217,80%,82%)] border-line-2',
  };
  return <span className={`inline-flex items-center font-mono text-[12px] px-2 py-1 rounded-md border ${tones[kind]}`}>{children}</span>;
}

function PrimaryBtn({
  children, onClick, disabled,
}: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-accent text-black hover:bg-[hsl(217,100%,75%)] disabled:bg-bg-3 disabled:text-ink-4 disabled:cursor-not-allowed transition-colors"
    >
      {children}
    </button>
  );
}

function GhostBtn({
  children, onClick,
}: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-transparent text-ink-2 hover:bg-bg-3 hover:text-ink transition-colors border border-line"
    >
      {children}
    </button>
  );
}
