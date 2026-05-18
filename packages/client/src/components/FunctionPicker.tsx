// Function/field picker — the shared library between Column Builder and Filter
// Builder. Driven entirely by the function-catalog metadata so it stays in
// lockstep with the parser/evaluator. Disabled functions still appear so users
// learn what's coming.
//
// Selecting a function inserts the call shape with placeholder args:
//   windowAvg(field, period)  → windowAvg(call_oi, 1m)  (sensible defaults)
// Selecting a field inserts the field name verbatim.

import { useMemo, useState } from "react";
import {
  FUNCTION_CATALOG,
  FIELD_CATALOG,
  CATEGORY_CATALOG,
  CLIENT_DURATIONS,
  BACKEND_DURATIONS,
  type Category,
  type FunctionSpec,
  type FieldSpec,
  type Status,
  type ArgSpec,
} from "@tradl/shared";
import type { CustomColumnDefinition, NumericField } from "../core/types";
import { Icon } from "./Icon";

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (snippet: string) => void;
  /** When provided, the Data category lists these custom columns as "Your columns". */
  customColumns?: CustomColumnDefinition[];
  /** When true, renders inline (no absolute positioning, no shadow), suitable
   *  for sitting in a side-rail of a parent modal. */
  embedded?: boolean;
}

const STATUS_LABEL: Record<Status, string> = {
  live: "Live",
  phase1: "Coming soon (Phase 1)",
  phase2: "Coming soon (Phase 2)",
  phase3: "Coming soon (Phase 3)",
};

const STATUS_BADGE: Record<Status, string> = {
  live: "text-pos bg-pill-pos",
  phase1: "text-ink-3 bg-bg-3",
  phase2: "text-ink-3 bg-bg-3",
  phase3: "text-ink-3 bg-bg-3",
};

function makeSnippet(spec: FunctionSpec): string {
  // Default arg values per kind, so the inserted call is parseable as-is.
  const slots: string[] = [];
  for (const arg of spec.args) {
    slots.push(defaultForArg(arg));
  }
  if (spec.rest) {
    slots.push(
      defaultForArg({ name: spec.rest.kind, kind: spec.rest.kind } as ArgSpec),
    );
    if (spec.rest.minCount > 1) {
      slots.push(
        defaultForArg({
          name: spec.rest.kind,
          kind: spec.rest.kind,
        } as ArgSpec),
      );
    }
  }
  return `${spec.technicalName}(${slots.join(", ")})`;
}

function defaultForArg(arg: ArgSpec): string {
  switch (arg.kind) {
    case "fieldRef":
      return "call_oi";
    case "duration":
      return arg.allowed?.[2] ?? "5s"; // typically 10s or similar
    case "integer":
      return "1";
    case "historicalAgg":
      return "'AVG'";
    case "expression":
      return "0";
    case "scope":
      // Inserted as a placeholder when the scope slot is included in the
      // snippet. Defaults to a common predicate (high-OI strikes) the user
      // can swap. `strike_*` reads the iterated strike.
      return "scope(strike_call_oi > 50000)";
    case "strikeRef":
      // Default points at the max-call-OI strike — the most common
      // "anchor on a notable strike" pattern.
      return "firstStrike(scope(strike_call_oi == chainMax(call_oi)))";
  }
}

// ───── Hover card ─────

function HoverCard({ spec }: { spec: FunctionSpec }) {
  return (
    <div className="absolute left-full top-0 ml-2 w-72 z-10 bg-bg-2 border border-line-2 rounded-md shadow-[0_8px_24px_rgba(0,0,0,0.5)] p-3">
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="text-[12.5px] font-semibold">{spec.friendlyName}</span>
        <span className="font-mono text-[10px] text-ink-3">
          · {spec.technicalName}
        </span>
      </div>
      <div className="text-[11px] text-ink-2 leading-[1.4] mb-2">
        {spec.kidDescription}
      </div>
      {(spec.args.length > 0 || spec.rest) && (
        <div className="mb-2">
          <div className="font-mono text-[9.5px] text-ink-3 uppercase tracking-[0.08em] mb-1">
            Arguments
          </div>
          <div className="space-y-0.5">
            {spec.args.map((a, i) => (
              <div key={i} className="font-mono text-[10.5px] text-ink-2">
                <span className="text-ink">{a.name}</span>
                <span className="text-ink-4"> · {a.kind}</span>
                {a.allowed && (
                  <span className="text-ink-4">
                    {" "}
                    ({a.allowed.slice(0, 4).join(", ")}
                    {a.allowed.length > 4 ? ", …" : ""})
                  </span>
                )}
              </div>
            ))}
            {spec.rest && (
              <div className="font-mono text-[10.5px] text-ink-2">
                <span className="text-ink">…rest</span>
                <span className="text-ink-4"> · {spec.rest.kind}</span>
              </div>
            )}
          </div>
        </div>
      )}
      <div className="mb-2">
        <div className="font-mono text-[9.5px] text-ink-3 uppercase tracking-[0.08em] mb-1">
          Example
        </div>
        <code className="block bg-bg-1 border border-line px-2 py-1 rounded font-mono text-[10.5px] text-codeblock break-all">
          {spec.example}
        </code>
        <div className="text-[10.5px] text-ink-3 mt-1 leading-[1.4]">
          → {spec.exampleMeaning}
        </div>
      </div>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] text-ink-4">
          returns: {spec.returns}
        </span>
        <span
          className={`font-mono text-[9.5px] px-1.5 py-0.5 rounded uppercase tracking-[0.06em] ${STATUS_BADGE[spec.status]}`}
        >
          {STATUS_LABEL[spec.status]}
        </span>
      </div>
    </div>
  );
}

// ───── Function row ─────

function FunctionItem({
  spec,
  onPick,
}: {
  spec: FunctionSpec;
  onPick: (s: string) => void;
}) {
  const [hover, setHover] = useState(false);
  const disabled = spec.status !== "live";
  // Reuse the Expression Mode token color class so the picker matches the
  // editor's syntax highlighting across all themes.
  const tokenClass = `expr-tok-fn-${spec.category}`;
  return (
    <div
      className="relative"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        onClick={() => {
          if (!disabled) onPick(makeSnippet(spec));
        }}
        disabled={disabled}
        className={`w-full text-left px-2 py-1 rounded flex items-center gap-2 ${
          disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-bg-3"
        }`}
      >
        <code className={`font-mono text-[11px] min-w-[110px] ${tokenClass}`}>
          {spec.technicalName}
        </code>
        <span className="text-[11px] truncate flex-1 text-ink-2">
          {spec.friendlyName}
        </span>
        {disabled && (
          <span className="font-mono text-[9.5px] text-ink-4 uppercase tracking-[0.06em] shrink-0">
            soon
          </span>
        )}
      </button>
      {hover && <HoverCard spec={spec} />}
    </div>
  );
}

// ───── Field row ─────

function FieldItem({
  spec,
  onPick,
}: {
  spec: FieldSpec;
  onPick: (s: string) => void;
}) {
  // Side-aware coloring — Call fields one color, Put fields another, Market neutral.
  // Matches the Expression Mode editor's token classes.
  const tokenClass = `expr-tok-field-${spec.group}`;
  return (
    <button
      onClick={() => onPick(spec.technicalName)}
      title={spec.description}
      className="w-full text-left px-2 py-1 rounded flex items-center gap-2 hover:bg-bg-3"
    >
      <code className={`font-mono text-[11px] min-w-[110px] ${tokenClass}`}>
        {spec.technicalName}
      </code>
      <span className="text-[11px] truncate flex-1 text-ink-2">
        {spec.friendlyName}
      </span>
    </button>
  );
}

// ───── Column row (custom columns shown in Data category) ─────

function ColumnItem({
  col,
  onPick,
}: {
  col: CustomColumnDefinition;
  onPick: (s: string) => void;
}) {
  return (
    <button
      onClick={() => onPick(col.name)}
      title={`Reference column "${col.name}" — formula: ${col.expression}`}
      className="w-full text-left px-2 py-1 rounded flex items-center gap-2 hover:bg-bg-3"
    >
      <code className="font-mono text-[11px] min-w-[110px] truncate expr-column">
        {col.name}
      </code>
      <span className="text-[11px] truncate flex-1 text-ink-2">
        {col.displayLabel ?? col.expression}
      </span>
    </button>
  );
}

// ───── Constant row ─────

function ConstantRow({
  name,
  value,
  onPick,
}: {
  name: string;
  value: string;
  onPick: (s: string) => void;
}) {
  return (
    <button
      onClick={() => onPick(value)}
      className="w-full text-left px-2 py-1 rounded flex items-center gap-2 hover:bg-bg-3"
    >
      <code className="font-mono text-[11px] min-w-[110px] expr-tok-const">
        {name}
      </code>
      <span className="text-[11px] truncate flex-1 text-ink-2">{value}</span>
    </button>
  );
}

// ───── Category section ─────

function CategorySection({
  category,
  defaultOpen,
  children,
  count,
}: {
  category: Category;
  defaultOpen: boolean;
  children: React.ReactNode;
  count: number;
}) {
  const meta = CATEGORY_CATALOG.find((c) => c.id === category)!;
  const [open, setOpen] = useState(defaultOpen);
  const enabled =
    meta.enabledStatus === "live" || meta.enabledStatus === "phase1";
  return (
    <div className="border border-line rounded-md mb-1.5 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center gap-2 px-2.5 py-1.5 bg-bg-1 ${enabled ? "" : "opacity-70"} hover:bg-bg-2`}
        title={meta.kidDescription}
      >
        <Icon
          name="chevRight"
          size={12}
          className={`transition-transform ${open ? "rotate-90" : ""}`}
        />
        <span className="text-[11.5px] font-medium">{meta.friendlyName}</span>
        <span className="font-mono text-[10px] text-ink-3">{count}</span>
        {meta.enabledStatus !== "live" && (
          <span className="ml-auto font-mono text-[9.5px] text-ink-4 uppercase tracking-[0.06em]">
            {meta.enabledStatus === "phase2"
              ? "Phase 2"
              : meta.enabledStatus === "phase3"
                ? "Phase 3"
                : "Phase 1"}
          </span>
        )}
      </button>
      {open && (
        <div className="px-1.5 py-1 border-t border-line">
          <div className="text-[10.5px] text-ink-3 px-1.5 pb-1 italic">
            {meta.kidDescription}
          </div>
          {children}
        </div>
      )}
    </div>
  );
}

// ───── Sub-group header (within a category) ─────

function SubgroupHeader({ name }: { name: string }) {
  return (
    <div className="font-mono text-[9.5px] text-ink-4 uppercase tracking-[0.08em] px-1.5 pt-1.5 pb-0.5">
      {name}
    </div>
  );
}

// ───── The picker itself ─────

export function FunctionPicker({
  open,
  onClose,
  onPick,
  customColumns,
  embedded,
}: Props) {
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return {
      functions: FUNCTION_CATALOG.filter(
        (f) =>
          f.technicalName.toLowerCase().includes(q) ||
          f.friendlyName.toLowerCase().includes(q) ||
          f.kidDescription.toLowerCase().includes(q),
      ),
      fields: FIELD_CATALOG.filter(
        (f) =>
          f.technicalName.toLowerCase().includes(q) ||
          f.friendlyName.toLowerCase().includes(q),
      ),
    };
  }, [query]);

  // Group functions by category + subgroup.
  const grouped = useMemo(() => {
    const out = new Map<Category, Map<string, FunctionSpec[]>>();
    for (const spec of FUNCTION_CATALOG) {
      let cat = out.get(spec.category);
      if (!cat) {
        cat = new Map();
        out.set(spec.category, cat);
      }
      const sub = cat.get(spec.subgroup) ?? [];
      sub.push(spec);
      cat.set(spec.subgroup, sub);
    }
    return out;
  }, []);

  const pick = (snippet: string) => {
    onPick(snippet);
    onClose();
  };

  if (!open) return null;

  const containerClass = embedded
    ? "w-full max-h-[60vh] overflow-y-auto bg-bg-1 border border-line rounded-md p-2"
    : "absolute right-0 top-full mt-1 z-20 w-[420px] max-h-[60vh] overflow-y-auto bg-bg-1 border border-line-2 rounded-md shadow-[0_12px_36px_rgba(0,0,0,0.6)] p-2";

  return (
    <div className={containerClass}>
      <div className="sticky top-0 bg-bg-1 pb-2 mb-1 border-b border-line z-10">
        <div className="flex items-center gap-2">
          <Icon name="search" size={13} className="text-ink-3" />
          <input
            autoFocus={!embedded}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search functions, fields…"
            className="flex-1 bg-bg-0 border border-line text-ink text-[11.5px] px-2 py-1 rounded outline-none focus:border-accent"
          />
          {!embedded && (
            <button
              onClick={onClose}
              className="text-ink-3 hover:text-ink p-1"
              title="Close (Esc)"
            >
              <Icon name="x" size={13} />
            </button>
          )}
        </div>
      </div>

      {matches ? (
        <SearchResults
          matches={matches}
          customColumns={customColumns ?? []}
          query={query}
          onPick={pick}
        />
      ) : (
        <BrowseTree
          grouped={grouped}
          customColumns={customColumns ?? []}
          onPick={pick}
        />
      )}
    </div>
  );
}

function SearchResults({
  matches,
  customColumns,
  query,
  onPick,
}: {
  matches: { functions: FunctionSpec[]; fields: FieldSpec[] };
  customColumns: CustomColumnDefinition[];
  query: string;
  onPick: (s: string) => void;
}) {
  const q = query.toLowerCase();
  const matchedColumns = customColumns.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.expression.toLowerCase().includes(q),
  );
  const total =
    matches.functions.length + matches.fields.length + matchedColumns.length;
  if (total === 0) {
    return (
      <div className="text-[11px] text-ink-3 px-2 py-3 text-center">
        no matches for "{query}"
      </div>
    );
  }
  return (
    <div>
      {matches.fields.length > 0 && (
        <div>
          <SubgroupHeader name={`Fields (${matches.fields.length})`} />
          {matches.fields.map((f) => (
            <FieldItem key={f.technicalName} spec={f} onPick={onPick} />
          ))}
        </div>
      )}
      {matchedColumns.length > 0 && (
        <div>
          <SubgroupHeader name={`Your columns (${matchedColumns.length})`} />
          {matchedColumns.map((c) => (
            <ColumnItem key={c.id} col={c} onPick={onPick} />
          ))}
        </div>
      )}
      {matches.functions.length > 0 && (
        <div>
          <SubgroupHeader name={`Functions (${matches.functions.length})`} />
          {matches.functions.map((f) => (
            <FunctionItem key={f.technicalName} spec={f} onPick={onPick} />
          ))}
        </div>
      )}
    </div>
  );
}

function BrowseTree({
  grouped,
  customColumns,
  onPick,
}: {
  grouped: Map<Category, Map<string, FunctionSpec[]>>;
  customColumns: CustomColumnDefinition[];
  onPick: (s: string) => void;
}) {
  const fieldsByGroup = useMemo(() => {
    const m = new Map<FieldSpec["group"], FieldSpec[]>();
    for (const f of FIELD_CATALOG) {
      const list = m.get(f.group) ?? [];
      list.push(f);
      m.set(f.group, list);
    }
    return m;
  }, []);

  return (
    <div>
      {/* Data category — custom: fields + columns + constants. */}
      <CategorySection
        category="data"
        defaultOpen
        count={FIELD_CATALOG.length + customColumns.length + 2 /* PI + E */}
      >
        <SubgroupHeader name="Market" />
        {(fieldsByGroup.get("market") ?? []).map((f) => (
          <FieldItem key={f.technicalName} spec={f} onPick={onPick} />
        ))}
        <SubgroupHeader name="Call side" />
        {(fieldsByGroup.get("callSide") ?? []).map((f) => (
          <FieldItem key={f.technicalName} spec={f} onPick={onPick} />
        ))}
        <SubgroupHeader name="Put side" />
        {(fieldsByGroup.get("putSide") ?? []).map((f) => (
          <FieldItem key={f.technicalName} spec={f} onPick={onPick} />
        ))}
        {customColumns.length > 0 && (
          <>
            <SubgroupHeader name="Your columns" />
            {customColumns.map((c) => (
              <ColumnItem key={c.id} col={c} onPick={onPick} />
            ))}
          </>
        )}
        <SubgroupHeader name="Constants" />
        <ConstantRow name="PI" value="PI" onPick={onPick} />
        <ConstantRow name="E" value="E" onPick={onPick} />
      </CategorySection>

      {/* Math, Logic, Cross-strike (live now) */}
      {(["math", "logic", "crossStrike"] as Category[]).map((cat) => (
        <CategorySectionFor
          key={cat}
          category={cat}
          grouped={grouped}
          onPick={onPick}
          defaultOpen
        />
      ))}

      {/* Recent history, Past days (disabled now) */}
      {(["recentHistory", "pastDays"] as Category[]).map((cat) => (
        <CategorySectionFor
          key={cat}
          category={cat}
          grouped={grouped}
          onPick={onPick}
        />
      ))}
    </div>
  );
}

function CategorySectionFor({
  category,
  grouped,
  onPick,
  defaultOpen = false,
}: {
  category: Category;
  grouped: Map<Category, Map<string, FunctionSpec[]>>;
  onPick: (s: string) => void;
  defaultOpen?: boolean;
}) {
  const subs = grouped.get(category);
  if (!subs) return null;
  const total = [...subs.values()].reduce((n, list) => n + list.length, 0);
  return (
    <CategorySection
      category={category}
      defaultOpen={defaultOpen}
      count={total}
    >
      {[...subs.entries()].map(([sub, list]) => (
        <div key={sub}>
          <SubgroupHeader name={sub} />
          {list.map((spec) => (
            <FunctionItem
              key={spec.technicalName}
              spec={spec}
              onPick={onPick}
            />
          ))}
        </div>
      ))}
    </CategorySection>
  );
}

// Re-export NumericField for components that want to type-narrow against it
// in the same import line as FunctionPicker. Cheap convenience.
export type { NumericField };
// Unused-but-handy re-export of duration vocabularies for any UI that wants to
// surface them inline (e.g. a duration dropdown).
export { CLIENT_DURATIONS, BACKEND_DURATIONS };
