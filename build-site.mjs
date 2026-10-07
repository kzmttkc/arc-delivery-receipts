// Builds the public results page and the "check before paying" JSON from published round files.
// Seller host names stay anonymised (Host A, B, ...) until each host has had 72 hours with its own results:
// set NAMED_HOSTS=host1,host2 to name the hosts whose notice window has passed.
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'public';
const rounds = fs.existsSync(`${OUT}/rounds`) ? fs.readdirSync(`${OUT}/rounds`).map(Number).filter(Boolean).sort((a, b) => a - b) : [];
if (!rounds.length) { console.error('no rounds yet'); process.exit(1); }
const latest = Number(process.env.MAIN_ROUND ?? rounds.at(-1)); // the full round shown in the main table
const retests = rounds.filter((r) => r > latest); // later rounds that re-test single sellers after a fix
const round = JSON.parse(fs.readFileSync(`${OUT}/rounds/${latest}/records.json`, 'utf8'));
const V = JSON.parse(fs.readFileSync(`${OUT}/rounds/${latest}/verdicts.json`, 'utf8'));
const vOf = Object.fromEntries(V.verdicts.map((v) => [v.index, v]));
const deploy = JSON.parse(fs.readFileSync('state/deploy.json', 'utf8'));
const plan = JSON.parse(fs.readFileSync(process.env.PLAN ?? 'data/plan-3.json', 'utf8'));
const plan0 = JSON.parse(fs.readFileSync('data/plan.json', 'utf8'));
const sel = JSON.parse(fs.readFileSync('data/selection.json', 'utf8'));
const listings = JSON.parse(fs.readFileSync(`data/${sel.source.replace(/^data\//, '')}`, 'utf8'));
const named = new Set((process.env.NAMED_HOSTS ?? '').split(',').filter(Boolean));
const paid = round.records.filter((r) => r.authorization);
const hosts = [...new Set(paid.map((r) => r.host))].sort((a, b) => paid.filter((r) => r.host === b).length - paid.filter((r) => r.host === a).length);
const label = (h) => (named.has(h) ? h : `Host ${String.fromCharCode(65 + hosts.indexOf(h))}`);
const pct = (a, b) => (b ? `${Math.round((a / b) * 1000) / 10}%` : '–');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const STAGES = ['http2xx', 'nonEmpty', 'mimeMatch', 'schemaMatch'];

// ---- JSON API: one file per payTo, plus an index ----
const byPayTo = {};
// The lookup API uses each seller's most recent round: re-test rounds replace the main round for the hosts they cover.
const retestHosts = new Set(retests.flatMap((rn) => JSON.parse(fs.readFileSync(`${OUT}/rounds/${rn}/records.json`, 'utf8')).records.map((r) => r.host)));
const apiRows = [...paid.filter((r) => !retestHosts.has(r.host)).map((r) => [r, vOf[r.index], latest]),
  ...retests.flatMap((rn) => { const RR = JSON.parse(fs.readFileSync(`${OUT}/rounds/${rn}/records.json`, 'utf8')); const VV = Object.fromEntries(JSON.parse(fs.readFileSync(`${OUT}/rounds/${rn}/verdicts.json`, 'utf8')).verdicts.map((v) => [v.index, v]));
    return RR.records.filter((r) => r.authorization).map((r) => [r, VV[r.index], rn]); })];
for (const [r, v, rn] of apiRows) {
  const k = r.authorization.to.toLowerCase();
  (byPayTo[k] ??= { payTo: r.authorization.to, network: 'eip155:5042', purchases: 0, charged: 0, delivered: 0, outcomes: {}, lastChecked: null, evidence: [] });
  const s = byPayTo[k];
  s.purchases++; if (v.charged) s.charged++; if (v.outcome === 'delivered') s.delivered++;
  s.outcomes[v.outcome] = (s.outcomes[v.outcome] ?? 0) + 1;
  s.lastChecked = [s.lastChecked, r.finishedAt].filter(Boolean).sort().at(-1);
  s.evidence.push({ round: rn, index: r.index, nonce: r.authorization.nonce, leaf: r.leaf });
}
fs.mkdirSync(`${OUT}/api/v1/arc/sellers`, { recursive: true });
for (const s of Object.values(byPayTo)) {
  s.deliveryRate = s.charged ? s.delivered / s.charged : null; // delivered out of the calls the seller actually charged
  s.ledger = deploy.ledger; s.roundsFile = `rounds/${s.evidence[0]?.round ?? latest}/records.json`;
  fs.writeFileSync(`${OUT}/api/v1/arc/sellers/${s.payTo.toLowerCase()}.json`, JSON.stringify(s, null, 1));
}
fs.writeFileSync(`${OUT}/api/v1/arc/sellers/index.json`, JSON.stringify(Object.values(byPayTo).map(({ evidence, ...s }) => s), null, 1));

// ---- funnel ----
const charged = V.verdicts.filter((v) => v.charged);
const funnel = [
  ['Arc x402 listings payable through Circle Gateway (Circle Discovery API)', listings.arcGateway],
  ['after the safety rules (GET/POST, ≤ $1, no state-changing endpoint, no unfilled path id)', sel.chosen],
  ['answering a live 402 with a Gateway option on Arc', plan0.purchases + plan0.notBought.filter((n) => !/^no 402|no Gateway/.test(n.reason)).length],
  ['with every required input either not needed or given an example by the seller itself', plan.purchases],
  ['paid (signed authorization sent) in this round', paid.length],
  ['charged by the seller (a transfer exists in Circle Gateway)', charged.length],
  ['delivered (charged, and the response passed all four checks)', V.verdicts.filter((v) => v.outcome === 'delivered').length],
];

// ---- traced example: the first delivered purchase ----
const ex = paid.find((r) => vOf[r.index].outcome === 'delivered' && vOf[r.index].settlementTx) ?? paid.find((r) => vOf[r.index].outcome === 'delivered') ?? paid[0];
const hostRows = hosts.map((h) => {
  const vs = V.verdicts.filter((v) => v.host === h);
  const ch = vs.filter((v) => v.charged), del = vs.filter((v) => v.outcome === 'delivered');
  const notCh = Object.entries(vs.filter((v) => !v.charged).reduce((m, v) => ((m[v.outcome] = (m[v.outcome] ?? 0) + 1), m), {})).map(([k, n]) => `${k} ${n}`).join(', ') || '–';
  const bad = Object.entries(ch.filter((v) => v.outcome !== 'delivered').reduce((m, v) => ((m[v.outcome] = (m[v.outcome] ?? 0) + 1), m), {})).map(([k, n]) => `${k} ${n}`).join(', ') || '–';
  return `<tr><td>${esc(label(h))}</td><td>${vs.length}</td><td>${ch.length}</td><td><b>${pct(del.length, ch.length)}</b> <small>(${del.length}/${ch.length})</small></td><td>${esc(bad)}</td><td>${esc(notCh)}</td></tr>`;
}).join('\n');

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Arc Delivery Receipts</title><meta name="description" content="Buyer-side delivery receipts for x402 purchases settled through Circle Gateway batches on Arc.">
<style>:root{--bg:#fff;--fg:#111;--mut:#666;--line:#ddd;--acc:#0b57d0}@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#111;--fg:#eee;--mut:#aaa;--line:#333;--acc:#8ab4f8}}
body{background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,sans-serif;max-width:960px;margin:0 auto;padding:24px 16px}a{color:var(--acc)}table{border-collapse:collapse;width:100%;font-size:14px}td,th{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left}
code,pre{font:13px ui-monospace,monospace}pre{overflow-x:auto;border:1px solid var(--line);padding:12px}small,.mut{color:var(--mut)}ol li{margin:6px 0}.wrap{overflow-x:auto}</style></head><body>
<h1>Arc Delivery Receipts</h1>
<p>Circle Gateway nanopayments batch settlement, so a buyer gets no per-payment receipt on chain. This page restores one for purchases on Arc: each signed Gateway authorization is checked against Circle Gateway’s record: a batch settlement and the buyer’s balance change or, for a seller that declares a prepaid balance, settled top-ups that cover the call. A Merkle root of what each seller returned is recorded on Arc before anything is published.</p>
<p class="mut">Round ${latest} · ${esc(round.records[0]?.startedAt?.slice(0, 10) ?? '')} · ledger <a href="https://explorer.arc.io/address/${deploy.ledger}"><code>${deploy.ledger}</code></a> · anchor tx ${round.anchorTx ? `<a href="https://explorer.arc.io/tx/${round.anchorTx}"><code>${round.anchorTx.slice(0, 18)}…</code></a>` : '–'}</p>
<h2>From listing to delivery</h2><div class="wrap"><table>${funnel.map(([k, v]) => `<tr><td>${esc(k)}</td><td><b>${v}</b></td></tr>`).join('')}</table></div>
<h2>By seller</h2><p class="mut">“Paid” counts signed authorizations we sent. “Charged” counts those Circle Gateway recorded as transfers. The delivery rate is over charged calls, so a seller that refuses a bad request without charging is not penalised. Host names are shown after each host has had 72 hours with its own results.</p>
<div class="wrap"><table><tr><th>Seller</th><th>Paid</th><th>Charged</th><th>Delivered of charged</th><th>Charged, not delivered</th><th>Not charged</th></tr>${hostRows}</table></div>
${retests.map((rn) => {
  const V2 = JSON.parse(fs.readFileSync(`${OUT}/rounds/${rn}/verdicts.json`, 'utf8'));
  const R2 = JSON.parse(fs.readFileSync(`${OUT}/rounds/${rn}/records.json`, 'utf8'));
  const hs = [...new Set(V2.verdicts.map((v) => v.host))];
  const rows = hs.map((h) => { const vs = V2.verdicts.filter((v) => v.host === h); const ch = vs.filter((v) => v.charged); const del = vs.filter((v) => v.outcome === 'delivered');
    const other = Object.entries(vs.filter((v) => v.outcome !== 'delivered').reduce((m, v) => ((m[v.outcome] = (m[v.outcome] ?? 0) + 1), m), {})).map(([k, n]) => `${k} ${n}`).join(', ') || '–';
    return `<tr><td>${esc(label(h))}</td><td>${vs.length}</td><td>${ch.length}</td><td><b>${pct(del.length, ch.length)}</b> <small>(${del.length}/${ch.length})</small></td><td>${esc(other)}</td></tr>`; }).join('');
  return `<h2>Re-test after a seller's fix (round ${rn})</h2><p class="mut">${esc(JSON.parse(fs.readFileSync(process.env['PLAN_' + rn] ?? `data/plan-${rn}.json`, 'utf8')).note ?? '')}. Anchored in tx ${R2.anchorTx ? `<a href="https://explorer.arc.io/tx/${R2.anchorTx}"><code>${R2.anchorTx.slice(0, 18)}…</code></a>` : '–'}.</p><div class="wrap"><table><tr><th>Seller</th><th>Paid</th><th>Charged</th><th>Delivered of charged</th><th>Other outcomes</th></tr>${rows}</table></div>`;
}).join('\n')}
<h2>Follow one purchase end to end</h2><ol>
<li>Signed authorization (EIP-712, <code>GatewayWalletBatched</code> on Arc): nonce <code>${esc(ex.authorization.nonce)}</code>, ${Number(ex.authorization.value) / 1e6} USDC to <code>${esc(ex.authorization.to)}</code>.</li>
<li>Circle Gateway maps the nonce to its batch: <a href="https://gateway-api.circle.com/v1/x402/transfers?network=eip155:5042&amp;nonce=${ex.authorization.nonce}">Gateway API</a>.</li>
<li>It settled in batch tx ${vOf[ex.index].settlementTx ? `<a href="https://explorer.arc.io/tx/${vOf[ex.index].settlementTx}"><code>${vOf[ex.index].settlementTx.slice(0, 18)}…</code></a>` : '(pending)'}; in that tx the buyer’s Gateway balance fell by exactly the sum of its charged authorizations (checked by <code>verify.mjs</code> from Arc RPC).</li>
<li>What came back: HTTP ${ex.status}, ${ex.responseBytes} bytes, <code>${esc(ex.contentType ?? '')}</code>, sha256 <code>${esc(ex.responseHash)}</code>.</li>
<li>That record is leaf <code>${esc(ex.leaf)}</code>; its Merkle proof leads to the root stored in DeliveryLedger round ${latest}.</li></ol>
<h2>Check a seller before paying</h2><pre>// GET https://kzmttkc.github.io/arc-delivery-receipts/api/v1/arc/sellers/&lt;payTo&gt;.json  →  { deliveryRate, purchases, lastChecked, evidence[] }
client.onBeforePaymentCreation(async (ctx) =&gt; {
  const payTo = ctx.selectedRequirements.payTo.toLowerCase();
  const r = await fetch(\`https://kzmttkc.github.io/arc-delivery-receipts/api/v1/arc/sellers/\${payTo}.json\`);
  if (!r.ok) return;                                  // never checked: your call
  const s = await r.json();
  if (s.purchases &gt;= 3 &amp;&amp; s.deliveryRate &lt; 0.8) {
    return { abort: true, reason: \`delivery rate \${s.deliveryRate} over \${s.purchases} paid calls\` };
  }
});</pre>
<p class="mut">The same per-seller history is the kind of data an agent-transaction insurer would need to price a policy.</p>
<h2>Verify it yourself</h2><pre>git clone https://github.com/kzmttkc/arc-delivery-receipts &amp;&amp; cd arc-delivery-receipts &amp;&amp; npm ci
node verify.mjs public/rounds/${latest}/records.json</pre>
<p>What it proves and what it does not: it proves which authorizations the buyer signed, that Circle settled them in batches that debited the buyer by exactly those amounts, and which bytes each seller returned, fixed on Arc before publication. Seller-side credits are netted with other buyers in the same batch, so they can be checked only in aggregate. A “delivered” result says the response passed four published checks, not that its content was useful.</p>
<p class="mut">Method: <a href="https://github.com/kzmttkc/arc-delivery-receipts/blob/main/METHOD.md">METHOD.md</a> · Code and records: <a href="https://github.com/kzmttkc/arc-delivery-receipts">github.com/kzmttkc/arc-delivery-receipts</a>. Independent of Circle; not endorsed by Circle or Arc.</p>
</body></html>`;
fs.writeFileSync(`${OUT}/index.html`, html);
console.log(`site built: round ${latest}, ${paid.length} paid, ${Object.keys(byPayTo).length} payTo files`);
