import { useQuery } from '@tanstack/react-query';
import { fetchExpiries } from '../services/optionChainApi';

// Returns the expiry list for the given symbol. Symbol is part of the cache
// key so switching symbols transparently swaps to whatever's cached (or
// triggers a fresh fetch). Errors are swallowed at the caller — the header
// just keeps showing whatever expiry it had.
export function useExpiries(symbol: string) {
  return useQuery({
    queryKey: ['expiries', symbol],
    queryFn: ({ signal }) => fetchExpiries(symbol, signal),
    enabled: !!symbol,
  });
}
