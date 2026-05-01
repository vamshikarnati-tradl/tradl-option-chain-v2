type Kind = 'field' | 'op' | 'value' | 'mult' | 'expr';

interface Props {
  children: React.ReactNode;
  kind?: Kind;
  size?: 'sm' | 'md';
}

const KIND_CLASSES: Record<Kind, string> = {
  field: 'bg-chip-field text-field border-chip-field-border',
  op: 'bg-bg-3 text-ink-2 border-line-2',
  value: 'bg-chip-value text-value border-chip-value-border',
  mult: 'bg-chip-mult text-multiplier border-chip-mult-border',
  expr: 'bg-bg-3 text-codeblock border-line-2',
};

export function Chip({ children, kind = 'field', size = 'md' }: Props) {
  const sz = size === 'sm'
    ? 'text-[11px] px-1.5 py-0.5 rounded'
    : 'text-[12px] px-2 py-1 rounded-md';
  return (
    <span className={`inline-flex items-center font-mono ${sz} border ${KIND_CLASSES[kind]}`}>
      {children}
    </span>
  );
}
