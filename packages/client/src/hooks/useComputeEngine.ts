import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ComputeBridge,
  type ComputeOutput,
  type ComputeStats,
  type ConfigErrors,
} from '../core/compute-bridge';
import type {
  ColumnResult, CustomColumnDefinition, OptionChainRow, RuleDefinition, RuleResult,
} from '../core/types';

export interface ComputeState {
  ruleResults: RuleResult[];
  columnResults: ColumnResult[];
  stats: ComputeStats | null;
  configErrors: ConfigErrors;
}

const EMPTY_ERRORS: ConfigErrors = { ruleErrors: [], columnErrors: [] };

export function useComputeEngine(
  rows: OptionChainRow[],
  rules: RuleDefinition[],
  columns: CustomColumnDefinition[],
): ComputeState {
  // Lazy ref so the bridge is created exactly once per mounted component
  // and survives StrictMode's mount → unmount → remount dance in dev.
  const bridgeRef = useRef<ComputeBridge | null>(null);
  if (bridgeRef.current === null) bridgeRef.current = new ComputeBridge();
  const bridge = bridgeRef.current;

  const [output, setOutput] = useState<ComputeOutput | null>(null);
  const [errors, setErrors] = useState<ConfigErrors>(EMPTY_ERRORS);
  const lastSentRowsRef = useRef<OptionChainRow[] | null>(null);

  useEffect(() => {
    const off1 = bridge.onResult(setOutput);
    const off2 = bridge.onConfigErrors(setErrors);
    // Note: do NOT destroy() the bridge in cleanup. StrictMode dev would
    // terminate the worker on the simulated unmount and the same bridge
    // instance would re-attach to a dead worker on remount. The worker
    // gets cleaned up by the browser when the page unloads.
    return () => { off1(); off2(); };
  }, [bridge]);

  useEffect(() => {
    bridge.setRules(rules);
  }, [bridge, rules]);

  useEffect(() => {
    bridge.setColumns(columns);
  }, [bridge, columns]);

  useEffect(() => {
    if (rows.length === 0) return;
    if (lastSentRowsRef.current === rows) return;
    lastSentRowsRef.current = rows;
    bridge.updateData(rows);
  }, [bridge, rows]);

  return useMemo(
    () => ({
      ruleResults: output?.ruleResults ?? [],
      columnResults: output?.columnResults ?? [],
      stats: output?.stats ?? null,
      configErrors: errors,
    }),
    [output, errors],
  );
}
