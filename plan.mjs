// Turns selection + unpaid probe into the purchase plan and the published funnel.
// Bought: GET with no required inputs, or POST whose 402 declares a body. Everything else is listed with a reason.
import fs from 'node:fs';
const sel = Object.fromEntries(JSON.parse(fs.readFileSync('data/selection.json', 'utf8')).items.map((x) => [x.resource, x]));
const probe = JSON.parse(fs.readFileSync('data/probe.json', 'utf8'));
const requiresInput = (r) => {
  const i = sel[r]?.input ?? {};
  const b = i.body && typeof i.body === 'object' ? i.body : {};
  const q = i.queryParams && typeof i.queryParams === 'object' ? i.queryParams : {};
  return Boolean(b.required?.length || q.required?.length || Object.values(q).some((v) => v && typeof v === 'object' && v.required === true));
};
const plan = [], notBought = [];
for (const x of probe.items) {
  let why = null;
  if (x.error) why = `no 402 (${x.error})`;
  else if (x.status !== 402) why = `no 402 (HTTP ${x.status})`;
  else if (!x.gateway) why = 'no Gateway option on Arc in the live 402';
  else if (x.method === 'GET' && requiresInput(x.resource)) why = 'GET needs inputs the seller did not declare';
  else if (x.method === 'POST' && x.request.kind !== 'declared') why = 'POST without a declared request body';
  if (why) { notBought.push({ resource: x.resource, host: x.host, reason: why }); continue; }
  plan.push({ resource: x.resource, host: x.host, method: x.method, request: x.request, amount: x.gateway.amount, payTo: x.gateway.payTo,
    verifyingContract: x.gateway.verifyingContract, mimeType: x.mimeType, outputSchema: x.outputSchema });
}
fs.writeFileSync('data/plan.json', JSON.stringify({ builtAt: new Date().toISOString(), purchases: plan.length,
  costUSDC: (plan.reduce((s, p) => s + BigInt(p.amount), 0n)).toString(), items: plan, notBought }, null, 1));
console.log(`plan ${plan.length} purchases, $${Number(plan.reduce((s, p) => s + BigInt(p.amount), 0n)) / 1e6}; not bought ${notBought.length}`);
