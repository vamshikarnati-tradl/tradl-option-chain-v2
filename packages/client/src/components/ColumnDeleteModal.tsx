// Confirmation modal for deleting a custom column. When the column has
// dependent rules/columns, the modal lists them and switches to a strict
// cascade flow: the user either cancels or explicitly removes the column
// AND its dependents. No "delete only column" footgun.

import { Modal } from './Modal';
import { GhostBtn } from './atoms';
import { Icon } from './Icon';
import type {
  CustomColumnDefinition, RuleDefinition,
} from '../core/types';

interface Props {
  open: boolean;
  onClose: () => void;
  target: CustomColumnDefinition | null;
  dependents: {
    rules: RuleDefinition[];
    columns: CustomColumnDefinition[];
  };
  onConfirm: () => void;
}

export function ColumnDeleteModal({ open, onClose, target, dependents, onConfirm }: Props) {
  if (!target) return null;
  const total = dependents.rules.length + dependents.columns.length;
  const labelOf = (c: CustomColumnDefinition) => c.displayLabel ? `${c.displayLabel} (${c.name})` : c.name;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={total > 0 ? `Delete column "${target.name}"?` : 'Delete column?'}
      subtitle={total > 0 ? `${total} dependent${total === 1 ? '' : 's'}` : target.name}
      width={480}
    >
      <div>
        {total === 0 ? (
          <p className="text-[12px] text-ink-2 mb-4 leading-[1.5]">
            Delete <strong>{labelOf(target)}</strong>? This can't be undone.
          </p>
        ) : (
          <>
            <p className="text-[12px] text-ink-2 mb-3 leading-[1.5]">
              This will also delete{' '}
              <strong>{total} {total === 1 ? 'thing' : 'things'} that depend on{' '}
              <span className="font-mono">{target.name}</span></strong>:
            </p>
            <div className="bg-bg-1 border border-line rounded-md p-2.5 mb-4 max-h-[200px] overflow-y-auto">
              {dependents.rules.length > 0 && (
                <div className="mb-2">
                  <div className="font-mono text-[9.5px] text-ink-3 uppercase tracking-[0.08em] mb-1">
                    Rules ({dependents.rules.length})
                  </div>
                  <ul className="m-0 p-0 list-none space-y-0.5">
                    {dependents.rules.map((r) => (
                      <li key={r.id} className="flex items-center gap-2 text-[11px]">
                        <Icon name="bolt" size={11} className="text-ink-3 shrink-0" />
                        <span className="text-ink-2 truncate">{r.name}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {dependents.columns.length > 0 && (
                <div>
                  <div className="font-mono text-[9.5px] text-ink-3 uppercase tracking-[0.08em] mb-1">
                    Columns ({dependents.columns.length})
                  </div>
                  <ul className="m-0 p-0 list-none space-y-0.5">
                    {dependents.columns.map((c) => (
                      <li key={c.id} className="flex items-center gap-2 text-[11px]">
                        <Icon name="columns" size={11} className="text-ink-3 shrink-0" />
                        <span className="text-ink-2 truncate">{labelOf(c)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <p className="text-[11px] text-ink-3 mb-4">This can't be undone.</p>
          </>
        )}
        <div className="flex gap-1.5 justify-end">
          <GhostBtn onClick={onClose}>Cancel</GhostBtn>
          <button
            onClick={() => { onConfirm(); onClose(); }}
            className="inline-flex items-center gap-1.5 justify-center px-3 py-1.5 rounded text-xs font-semibold bg-neg text-white hover:bg-neg/90 transition-colors"
          >
            <Icon name="trash" size={12} />
            <span>
              {total > 0 ? `Delete column + ${total} dependent${total === 1 ? '' : 's'}` : 'Delete column'}
            </span>
          </button>
        </div>
      </div>
    </Modal>
  );
}
