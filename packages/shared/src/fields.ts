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

export type NumericField = Exclude<keyof OptionChainRow, 'expiryDate'>;

export const NUMERIC_FIELDS: readonly NumericField[] = [
  'strikePrice', 'underlyingValue',
  'call_oi', 'call_oiChange', 'call_volume', 'call_iv', 'call_ltp', 'call_netChange',
  'call_bidQty', 'call_bidPrice', 'call_askQty', 'call_askPrice',
  'put_oi', 'put_oiChange', 'put_volume', 'put_iv', 'put_ltp', 'put_netChange',
  'put_bidQty', 'put_bidPrice', 'put_askQty', 'put_askPrice',
];
