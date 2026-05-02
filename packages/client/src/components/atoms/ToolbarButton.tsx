interface Props {
  active?: boolean;
  onClick?: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
}

// Header-style toolbar button — used by the Rules / Columns / Ask triggers
// in <Header>. Active state mirrors the side-panel "open" tint. Padding/gap
// shrink on `< sm` viewports so icon-only mobile variants pack tightly.
export function ToolbarButton({ active = false, onClick, title, children, className = '' }: Props) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`inline-flex items-center gap-1 sm:gap-1.5 h-7 px-2 sm:px-2.5 rounded-md border text-xs font-medium transition-all ${
        active
          ? 'bg-bg-3 text-ink border-accent'
          : 'bg-transparent text-ink-2 border-line-2 hover:bg-bg-2 hover:text-ink'
      } ${className}`}
    >
      {children}
    </button>
  );
}
