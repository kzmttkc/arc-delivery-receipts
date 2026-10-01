// Round 4: re-test of one seller after it reported a fix. Re-reads each listing's live 402 (unpaid) so the plan
// carries the price and payTo offered now, and keeps the round-3 request (seller-declared inputs only).
import fs from 'node:fs';
const HOST = process.argv[2] ?? 'np.orthogonal.com';
const p3 = JSON.parse(fs.readFileSync('data/plan-3.json', 'utf8'));
const items = [];
for (const p of p3.items.filter((x) => x.host === HOST)) {
  const url = new URL(p.resource);
  if (p.request?.query) for (const [k, v] of Object.entries(p.request.query)) url.searchParams.set(k, String(v));
  const r = await fetch(url, { method: p.method, headers: { 'content-type': 'application/json' }, body: p.method === 'POST' ? JSON.stringify(p.request?.body ?? {}) : undefined, signal: AbortSignal.timeout(20000) }).catch((e) => ({ status: 0, headers: new Headers() }));
  const h = r.headers.get('PAYMENT-REQUIRED');
  const pr = r.status === 402 && h ? JSON.parse(Buffer.from(h, 'base64').toString()) : null;
  const opt = pr?.accepts?.find((a) => a.network === 'eip155:5042' && a.extra?.name === 'GatewayWalletBatched');
  if (!opt || BigInt(opt.amount) > 1_000_000n) { console.log('skip', r.status, p.resource); continue; }
  items.push({ ...p, amount: opt.amount, payTo: opt.payTo, verifyingContract: opt.extra.verifyingContract, hasResource: Boolean(pr.resource?.url) });
  await new Promise((ok) => setTimeout(ok, 300));
}
const cost = items.reduce((s, x) => s + BigInt(x.amount), 0n);
fs.writeFileSync('data/plan-4.json', JSON.stringify({ builtAt: new Date().toISOString(), method: 'v1', note: `re-test of ${HOST} after the seller reported a fix (2026-09-29)`, purchases: items.length, costUSDC: cost.toString(), items, notBought: [] }, null, 1));
console.log(`round 4 plan: ${items.length} purchases, up to $${Number(cost) / 1e6}; 402 now carries resource: ${items.filter((x) => x.hasResource).length}/${items.length}`);
