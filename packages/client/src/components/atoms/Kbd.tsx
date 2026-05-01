interface Props {
  children: React.ReactNode;
  size?: 'xs' | 'sm';
  className?: string;
}

export function Kbd({ children, size = 'sm', className = '' }: Props) {
  const sz = size === 'xs' ? 'text-[9px] px-1 py-px' : 'text-[10px] px-1.5 py-0.5';
  return (
    <kbd className={`font-mono ${sz} bg-bg-3 text-ink-2 rounded border border-line-2 ${className}`}>
      {children}
    </kbd>
  );
}
