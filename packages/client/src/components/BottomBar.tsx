import { Icon, type IconName } from './Icon';

interface Props {
  ruleCount: number;
  columnCount: number;
  rulesOpen: boolean;
  columnsOpen: boolean;
  onAsk: () => void;
  onToggleRules: () => void;
  onToggleColumns: () => void;
}

// Mobile-only thumb-reachable action bar. Carries the chrome buttons that
// would otherwise blow out the header on narrow viewports — Ask, Rules,
// Columns. Hidden on `md+` where the header has room for them.
//
// Safe-area inset keeps the buttons above iOS home indicator without
// leaving a gap on devices that don't have one.
export function BottomBar({
  ruleCount, columnCount,
  rulesOpen, columnsOpen,
  onAsk, onToggleRules, onToggleColumns,
}: Props) {
  return (
    <nav
      className="md:hidden flex-shrink-0 h-12 bg-bg-1 border-t border-line flex items-stretch"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <BarButton onClick={onAsk} label="Ask">
        <span className="text-accent text-base leading-none">✦</span>
      </BarButton>
      <BarButton onClick={onToggleRules} active={rulesOpen} label="Rules" badge={ruleCount} icon="bolt" />
      <BarButton onClick={onToggleColumns} active={columnsOpen} label="Columns" badge={columnCount} icon="columns" />
    </nav>
  );
}

interface BarBtnProps {
  onClick: () => void;
  label: string;
  active?: boolean;
  badge?: number;
  icon?: IconName;
  children?: React.ReactNode;
}

function BarButton({ onClick, label, active = false, badge, icon, children }: BarBtnProps) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-1.5 text-[11px] font-medium border-t-2 transition-colors ${
        active
          ? 'border-accent text-ink bg-bg-2'
          : 'border-transparent text-ink-2 hover:bg-bg-2'
      }`}
    >
      {children}
      {icon && <Icon name={icon} size={15} />}
      <span>{label}</span>
      {badge !== undefined && (
        <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded min-w-[18px] text-center ${
          active ? 'bg-accent text-black font-semibold' : 'bg-bg-3 text-ink-2'
        }`}>
          {badge}
        </span>
      )}
    </button>
  );
}
