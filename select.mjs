// Chooses which Arc Gateway listings to buy, with a written reason for every exclusion.
// Policy (published in METHOD.md): GET or POST only; price <= $1; no endpoint whose own description says it
// changes state (send, create, delete, update, register, transfer, order, trade, mint, publish, key management);
// no path with an unfilled {placeholder}.
import fs from 'node:fs';
const src = process.argv[2] ?? fs.readdirSync('data').filter((f) => f.startsWith('arc-gateway-listings-')).sort().pop();
const d = JSON.parse(fs.readFileSync(`data/${src.replace(/^data\//, '')}`, 'utf8'));
const MAX = 1_000_000n; // $1.00 in USDC base units
const SIDE_EFFECT = /\b(send|create|delete|remove|update|register|transfer|order|trade|buy|sell|mint|publish|post (a|to)|reply|follow|subscribe|cancel|withdraw|deposit|api[- ]?keys?|password|token rotation|webhook)\b/i;
const chosen = [], excluded = [];
for (const it of d.items) {
  const why = !['GET', 'POST'].includes(it.method) ? `method ${it.method}`
    : BigInt(it.amount) > MAX ? `price ${Number(it.amount) / 1e6} > $1`
    : /\{[^}]+\}/.test(it.resource) ? 'path has an unfilled {placeholder} (we do not invent ids)'
    : SIDE_EFFECT.test(`${it.description ?? ''} ${it.resource}`) ? 'description or path says it changes state'
    : null;
  (why ? excluded : chosen).push(why ? { resource: it.resource, host: it.host, reason: why } : it);
}
const out = { source: src, policy: 'GET/POST, <= $1, no state-changing endpoints', chosen: chosen.length, excluded: excluded.length,
  cost: chosen.reduce((s, x) => s + BigInt(x.amount), 0n).toString(), items: chosen, exclusions: excluded };
fs.writeFileSync('data/selection.json', JSON.stringify(out, null, 1));
const byReason = excluded.reduce((m, x) => ((m[x.reason.replace(/[\d.]+/g, 'N')] = (m[x.reason.replace(/[\d.]+/g, 'N')] ?? 0) + 1), m), {});
console.log(`chosen ${chosen.length} ($${Number(out.cost) / 1e6}) / excluded ${excluded.length}`, byReason);
const byHost = chosen.reduce((m, x) => ((m[x.host] = (m[x.host] ?? 0) + 1), m), {});
console.log(byHost);
