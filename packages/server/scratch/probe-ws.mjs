import WebSocket from 'ws';
const ws = new WebSocket('ws://localhost:4001/ws/option-chain/NIFTY');
let snapshots = 0;
ws.on('open', () => console.log('client WS open'));
ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === 'snapshot') {
    snapshots++;
    const r = msg.payload.rows[0];
    if (snapshots <= 3) {
      console.log(`snapshot #${snapshots}: ${msg.payload.rows.length} strikes, spot ${msg.payload.underlyingValue}, sample row[0]: strike=${r?.strikePrice} call_iv=${r?.call_iv} call_delta=${r?.call_delta} call_oi=${r?.call_oi}`);
    }
  } else {
    console.log('msg:', JSON.stringify(msg).slice(0, 200));
  }
});
ws.on('error', (e) => console.error('error', e.message));
ws.on('close', () => console.log(`closed, ${snapshots} snapshots total`));
setTimeout(() => { ws.close(); process.exit(0); }, 6000);
