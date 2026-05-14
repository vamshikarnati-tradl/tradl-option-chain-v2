// Click-a-literal slider — when bound to a numeric literal in the expression
// source, dragging the slider rewrites that literal's char range in the
// source string and re-emits. Min/max derived from the literal's magnitude.

import type { RuleSlider } from '../../core/types';
import { fmtCompact } from '../../utils/format';

interface Props {
  source: string;
  slider: RuleSlider | undefined;
  onChange: (next: { source: string; slider?: RuleSlider }) => void;
}

/** Read the current bound literal as a number, given the source + slider. */
export function readBoundLiteral(source: string, slider: RuleSlider): number | null {
  // Walk forward from literalOffset until we hit a non-numeric character.
  // Accept the leading `-` if present (unary-minus fused literal).
  let i = slider.literalOffset;
  if (source[i] === '-') i++;
  let end = i;
  while (end < source.length && /[0-9.]/.test(source[end])) end++;
  if (end === i) return null;
  const slice = source.slice(slider.literalOffset, end);
  const n = Number(slice);
  return Number.isFinite(n) ? n : null;
}

/** Compute the [start, end) char range of the bound literal in the source. */
function boundRange(source: string, slider: RuleSlider): { start: number; end: number } | null {
  let i = slider.literalOffset;
  if (source[i] === '-') i++;
  let end = i;
  while (end < source.length && /[0-9.]/.test(source[end])) end++;
  return end === i ? null : { start: slider.literalOffset, end };
}

function writeLiteral(source: string, range: { start: number; end: number }, value: number): string {
  return source.slice(0, range.start) + String(value) + source.slice(range.end);
}

export function SliderBinder({ source, slider, onChange }: Props) {
  if (!slider) return null;
  const value = readBoundLiteral(source, slider);
  const range = boundRange(source, slider);
  if (value === null || !range) return null;

  const handleChange = (next: number) => {
    const rangeNow = boundRange(source, slider);
    if (!rangeNow) return;
    onChange({
      source: writeLiteral(source, rangeNow, next),
      slider,
    });
  };

  return (
    <div className="bg-bg-1 border border-line rounded-md py-2.5 px-3 mb-2">
      <div className="flex justify-between items-baseline mb-2">
        <label className="text-[11px] text-ink-2">
          {slider.label ?? 'Threshold'}
          <span className="font-mono text-[9.5px] text-ink-4 ml-1.5">
            slider bound to literal at char {slider.literalOffset}
          </span>
        </label>
        <input
          type="number"
          value={value}
          step={slider.step}
          onChange={(e) => handleChange(parseFloat(e.target.value) || 0)}
          className="bg-bg-2 border border-line-2 text-ink font-mono text-[11px] w-[100px] px-2 py-1 rounded text-right outline-none focus:border-accent"
        />
      </div>
      <input
        type="range"
        className="thr-range w-full my-1"
        min={slider.min} max={slider.max} step={slider.step} value={value}
        onChange={(e) => handleChange(parseFloat(e.target.value))}
      />
      <div className="flex justify-between font-mono text-[9.5px] text-ink-4">
        <span>{fmtCompact(slider.min)}</span>
        <span>{fmtCompact(slider.max)}</span>
      </div>
    </div>
  );
}

/** Derive a sensible {min, max, step} for a slider given a literal value.
 *  Reused by the click-to-bind handler in the rule editor. */
export function deriveSliderBounds(value: number): Pick<RuleSlider, 'min' | 'max' | 'step'> {
  const abs = Math.abs(value);
  const step = abs >= 1000 ? Math.max(1, Math.round(abs / 100))
    : abs >= 10 ? 0.5
    : 0.05;
  const min = value < 0 ? Math.min(value * 4, -100_000) : 0;
  const max = value < 0 ? 0 : Math.max(value * 4, 100);
  return { min, max, step };
}
