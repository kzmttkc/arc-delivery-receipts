// Lists x402 resources that can be paid on Arc through Circle Gateway, from Circle's public Discovery API.
import fs from 'node:fs';
const API = 'https://api.circle.com/v2/x402/discovery/resources';
const ARC = 'eip155:5042';
const all = [];
for (let offset = 0; ; offset += 100) {
  const r = await fetch(`${API}?limit=100&offset=${offset}`);
  if (!r.ok) throw new Error(`discovery ${r.status}`);
  const d = await r.json();
  all.push(...d.items);
  if (offset + 100 >= d.pagination.total) break;
}
const arc = [];
for (const it of all) {
  const acc = it.accepts.find((a) => a.network === ARC && a.extra?.name === 'GatewayWalletBatched');
  if (!acc) continue;
  const m = it.metadata ?? {};
  arc.push({ resource: it.resource, host: new URL(it.resource).host, method: m.method ?? m.input?.method ?? 'GET', payTo: acc.payTo, amount: acc.amount, asset: acc.asset,
    verifyingContract: acc.extra?.verifyingContract, category: m.provider?.category, provider: m.provider?.name, description: m.description, mimeType: m.mimeType,
    input: m.input ?? null, outputSchema: m.output ?? null, lastUpdated: it.lastUpdated });
}
const day = new Date().toISOString().slice(0, 10);
fs.writeFileSync(`data/arc-gateway-listings-${day}.json`, JSON.stringify({ fetchedAt: new Date().toISOString(), totalDiscovery: all.length, arcGateway: arc.length, items: arc }, null, 1));
console.log(`discovery ${all.length} / arc gateway ${arc.length}`);
