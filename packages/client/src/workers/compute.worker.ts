/// <reference lib="webworker" />
import { ComputeEngine } from '../core/compute-engine';
import type { OptionChainRow, RuleDefinition, CustomColumnDefinition } from '../core/types';

type In =
  | { type: 'UPDATE_DATA'; rows: OptionChainRow[] }
  | { type: 'SET_RULES'; rules: RuleDefinition[] }
  | { type: 'SET_COLUMNS'; columns: CustomColumnDefinition[] };

type Out =
  | {
      type: 'COMPUTE_RESULTS';
      ruleResults: ReturnType<ComputeEngine['computeAll']>['ruleResults'];
      columnResults: ReturnType<ComputeEngine['computeAll']>['columnResults'];
      durationMs: number;
      reusedRules: number;
      reusedCells: number;
      totalCells: number;
      computedAt: number;
    }
  | { type: 'CONFIG_ERRORS'; ruleErrors: { ruleId: string; error: string }[]; columnErrors: { columnId: string; error: string }[] };

const engine = new ComputeEngine();
let lastRows: OptionChainRow[] | null = null;

function postOut(msg: Out): void {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);
}

function compute(): void {
  if (!lastRows) return;
  const r = engine.computeAll(lastRows);
  postOut({
    type: 'COMPUTE_RESULTS',
    ruleResults: r.ruleResults,
    columnResults: r.columnResults,
    durationMs: r.durationMs,
    reusedRules: r.reusedRules,
    reusedCells: r.reusedCells,
    totalCells: r.totalCells,
    computedAt: Date.now(),
  });
}

self.onmessage = (e: MessageEvent<In>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'UPDATE_DATA':
      lastRows = msg.rows;
      compute();
      break;
    case 'SET_RULES': {
      const { errors } = engine.setRules(msg.rules);
      postOut({ type: 'CONFIG_ERRORS', ruleErrors: errors, columnErrors: [] });
      compute();
      break;
    }
    case 'SET_COLUMNS': {
      const { errors } = engine.setColumns(msg.columns);
      postOut({ type: 'CONFIG_ERRORS', ruleErrors: [], columnErrors: errors });
      compute();
      break;
    }
  }
};
