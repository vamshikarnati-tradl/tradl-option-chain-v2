interface Props {
  checked: boolean;
  onChange: () => void;
  ariaLabel?: string;
}

export function Switch({ checked, onChange, ariaLabel }: Props) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onChange(); }}
      aria-label={ariaLabel}
      className={`relative w-7 h-4 rounded-full p-0 border-0 shrink-0 transition-colors ${
        checked ? 'bg-accent' : 'bg-bg-4'
      }`}
    >
      <span className={`sw-knob absolute top-0.5 w-3 h-3 bg-white rounded-full ${
        checked ? 'left-[14px]' : 'left-0.5'
      }`} />
    </button>
  );
}
