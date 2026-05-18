// Main-thread wrapper around the compute Web Worker.
// Owns the worker lifecycle and exposes a typed API.

import type {
  ColumnResult, CustomColumnDefinition,
  OptionChainRow, RuleDefinition, RuleResult,
  ValueDefinition, ValueResult,
} from './types';

export interface ComputeStats {
  durationMs: number;
  reusedRules: number;
  reusedCells: number;
  totalCells: number;
  computedAt: number;
}

export interface ComputeOutput {
  ruleResults: RuleResult[];
  columnResults: ColumnResult[];
  valueResults: ValueResult[];
  stats: ComputeStats;
}

export interface ConfigErrors {
  ruleErrors: { ruleId: string; error: string }[];
  columnErrors: { columnId: string; error: string }[];
  valueErrors: { valueId: string; error: string }[];
  /** Column dependency cycles detected during topo-sort (column-name traces). */
  cycleErrors: string[];
}

type Listener<T> = (v: T) => void;

export class ComputeBridge {
  private worker: Worker;
  private resultListeners = new Set<Listener<ComputeOutput>>();
  private errorListeners = new Set<Listener<ConfigErrors>>();

  constructor() {
    this.worker = new Worker(new URL('../workers/compute.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => this.handle(e.data);
  }

  private handle(msg: any): void {
    if (msg?.type === 'COMPUTE_RESULTS') {
      const out: ComputeOutput = {
        ruleResults: msg.ruleResults,
        columnResults: msg.columnResults,
        valueResults: msg.valueResults ?? [],
        stats: {
          durationMs: msg.durationMs,
          reusedRules: msg.reusedRules,
          reusedCells: msg.reusedCells,
          totalCells: msg.totalCells,
          computedAt: msg.computedAt,
        },
      };
      for (const l of this.resultListeners) l(out);
    } else if (msg?.type === 'CONFIG_ERRORS') {
      for (const l of this.errorListeners) l({
        ruleErrors: msg.ruleErrors,
        columnErrors: msg.columnErrors,
        valueErrors: msg.valueErrors ?? [],
        cycleErrors: msg.cycleErrors ?? [],
      });
    }
  }

  onResult(cb: Listener<ComputeOutput>): () => void {
    this.resultListeners.add(cb);
    return () => this.resultListeners.delete(cb);
  }

  onConfigErrors(cb: Listener<ConfigErrors>): () => void {
    this.errorListeners.add(cb);
    return () => this.errorListeners.delete(cb);
  }

  setRules(rules: RuleDefinition[]): void {
    this.worker.postMessage({ type: 'SET_RULES', rules });
  }

  setColumns(columns: CustomColumnDefinition[]): void {
    this.worker.postMessage({ type: 'SET_COLUMNS', columns });
  }

  setValues(values: ValueDefinition[]): void {
    this.worker.postMessage({ type: 'SET_VALUES', values });
  }

  updateData(rows: OptionChainRow[]): void {
    this.worker.postMessage({ type: 'UPDATE_DATA', rows });
  }

  destroy(): void {
    this.worker.terminate();
    this.resultListeners.clear();
    this.errorListeners.clear();
  }
}
