interface Props {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}

export function GhostBtn({ children, onClick, className = '' }: Props) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 justify-center px-3 py-1.5 rounded text-xs font-medium bg-transparent text-ink-2 hover:bg-bg-3 hover:text-ink transition-colors border border-line ${className}`}
    >
      {children}
    </button>
  );
}
