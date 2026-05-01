interface Props {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}

export function PrimaryBtn({ children, onClick, disabled, className = '' }: Props) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 justify-center px-3 py-1.5 rounded text-xs font-semibold bg-accent text-black hover:bg-accent-hover disabled:bg-bg-3 disabled:text-ink-4 disabled:cursor-not-allowed transition-colors border border-transparent ${className}`}
    >
      {children}
    </button>
  );
}
