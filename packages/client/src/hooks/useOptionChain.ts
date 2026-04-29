import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { DataStore, type DataStoreState } from '../core/data-store';
import { WsClient } from '../core/ws-client';

export function useOptionChain(symbol: string): DataStoreState {
  const store = useMemo(() => new DataStore(symbol), [symbol]);

  useEffect(() => {
    const client = new WsClient({ symbol, store });
    client.start();
    return () => client.stop();
  }, [symbol, store]);

  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getState(),
  );
}
