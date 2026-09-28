// Unpaid probe: asks each chosen listing for its 402 and records what it declares. Signs and pays nothing.
// Request rule (same words as vet402's methodology): body/query = what the seller's 402 declares in
// extensions.bazaar.info.input ("declared"); nothing declared -> "empty". We never invent values.
import fs from 'node:fs';
const sel = JSON.parse(fs.readFileSync('data/selection.json', 'utf8'));
const out = [];
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
function declared(input) {
  if (!input) return { body: undefined, query: undefined, kind: 'empty' };
  const pick = (v) => (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length ? v : undefined);
  const body = pick(input.body) ?? pick(input.bodyExample) ?? pick(input.example);
  const query = pick(input.queryParams) ?? pick(input.query);
  const scalarQuery = query && Object.values(query).every((v) => ['string', 'number', 'boolean'].includes(typeof v)) ? query : undefined;
  return { body, query: scalarQuery, kind: body || scalarQuery ? 'declared' : 'empty' };
}
for (const it of sel.items) {
  const rec = { resource: it.resource, host: it.host, method: it.method, listedAmount: it.amount, listedPayTo: it.payTo };
  try {
    const r = await fetch(it.resource, { method: it.method, headers: { 'content-type': 'application/json' }, body: it.method === 'POST' ? '{}' : undefined, signal: AbortSignal.timeout(20000) });
    rec.status = r.status;
    const h = r.headers.get('PAYMENT-REQUIRED');
    if (r.status === 402 && h) {
      const pr = JSON.parse(Buffer.from(h, 'base64').toString());
      const opt = pr.accepts?.find((a) => a.network === 'eip155:5042' && a.extra?.name === 'GatewayWalletBatched');
      rec.gateway = opt ? { amount: opt.amount, payTo: opt.payTo, verifyingContract: opt.extra.verifyingContract, maxTimeoutSeconds: opt.maxTimeoutSeconds } : null;
      const d = declared(pr.extensions?.bazaar?.info?.input);
      rec.request = { kind: d.kind, body: d.body, query: d.query };
      rec.mimeType = pr.resource?.mimeType ?? it.mimeType ?? null;
      rec.outputSchema = pr.extensions?.bazaar?.info?.output ?? null;
    }
  } catch (e) { rec.error = String(e.name === 'TimeoutError' ? 'timeout' : e.message).slice(0, 200); }
  out.push(rec);
  process.stdout.write('.');
  await sleep(300);
}
fs.writeFileSync('data/probe.json', JSON.stringify({ probedAt: new Date().toISOString(), items: out }, null, 1));
const c = (f) => out.filter(f).length;
console.log(`\n402+gateway ${c((x) => x.gateway)} / 402 no-gateway ${c((x) => x.status === 402 && !x.gateway)} / other status ${c((x) => x.status && x.status !== 402)} / error ${c((x) => x.error)} / declared ${c((x) => x.request?.kind === 'declared')}`);
