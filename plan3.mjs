// Plan for round 3 (method v1). Starts from data/plan.json and uses what sellers declared in machine-readable form,
// including the uncharged 4xx that listed missing parameters in round 2 ("No payment was charged").
// A required input is filled only with the example value the seller itself gave; otherwise the listing is not bought.
import fs from 'node:fs';
const plan = JSON.parse(fs.readFileSync('data/plan.json', 'utf8'));
const dir = 'state/round-2/records';
const r2 = Object.fromEntries(fs.readdirSync(dir).map((f) => JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'))).map((r) => [r.resource, r]));
const body = (r) => { try { return JSON.parse(fs.readFileSync(`state/round-2/bodies/${String(r.index).padStart(3, '0')}.bin`, 'utf8')); } catch { return null; } };
const items = [], skipped = [];
for (const p of plan.items) {
  const prev = r2[p.resource];
  const charged = Boolean(prev?.settlement?.success);
  if (prev && prev.status >= 400 && prev.status < 500 && prev.status !== 402) {
    const b = body(prev);
    const spec = b?.input;
    const fields = { ...(spec?.queryParams ?? {}) };
    const req = Object.entries(fields).filter(([, v]) => v && typeof v === 'object' && v.required);
    if (!charged && req.length && req.every(([, v]) => v.example !== undefined)) {
      const query = Object.fromEntries(req.map(([k, v]) => [k, Array.isArray(v.example) ? v.example[0] : v.example]));
      items.push({ ...p, request: { kind: 'declared', query, source: 'seller 4xx input spec (uncharged)' } });
      continue;
    }
    skipped.push({ resource: p.resource, host: p.host, reason: charged ? 'charged for a request it then rejected in round 2; required input has no declared example'
      : 'required input without a declared example' });
    continue;
  }
  items.push(p);
}
const cost = items.reduce((s, p) => s + BigInt(p.amount), 0n);
fs.writeFileSync('data/plan-3.json', JSON.stringify({ builtAt: new Date().toISOString(), method: 'v1', purchases: items.length, costUSDC: cost.toString(), items, notBought: [...plan.notBought, ...skipped] }, null, 1));
const byHost = items.reduce((m, x) => ((m[x.host] = (m[x.host] ?? 0) + 1), m), {});
console.log(`round 3 plan: ${items.length} purchases, up to $${Number(cost) / 1e6} (only charged calls cost); skipped ${skipped.length}`, byHost);
