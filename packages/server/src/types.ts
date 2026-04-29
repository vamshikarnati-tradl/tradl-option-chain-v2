export interface OptionChainRow {
  strikePrice: number;
  expiryDate: string;

  call_oi: number;
  call_oiChange: number;
  call_volume: number;
  call_iv: number;
  call_ltp: number;
  call_netChange: number;
  call_bidQty: number;
  call_bidPrice: number;
  call_askQty: number;
  call_askPrice: number;

  put_oi: number;
  put_oiChange: number;
  put_volume: number;
  put_iv: number;
  put_ltp: number;
  put_netChange: number;
  put_bidQty: number;
  put_bidPrice: number;
  put_askQty: number;
  put_askPrice: number;

  underlyingValue: number;
}

export interface OptionChainSnapshot {
  symbol: string;
  expiryDate: string;
  underlyingValue: number;
  fetchedAt: number;
  rows: OptionChainRow[];
}

export type WsServerMessage =
  | { type: 'snapshot'; payload: OptionChainSnapshot }
  | { type: 'error'; message: string };
