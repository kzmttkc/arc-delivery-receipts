# Arc Delivery Receipts

Circle Gateway nanopayments settle x402 payments in batches, so a buyer gets no per-payment receipt on chain.
This repository buys from Arc x402 sellers through Gateway and restores that receipt:

- each signed Gateway authorization is matched to its batch settlement and to the buyer's balance change on Arc
- a Merkle root of what every seller returned is written to `DeliveryLedger` on Arc before results are published
- a per-seller delivery rate can be looked up before paying

## Verify a round yourself (about 5 minutes)

```bash
git clone https://github.com/kzmttkc/arc-delivery-receipts && cd arc-delivery-receipts && npm ci
node verify.mjs public/rounds/1/records.json
```

`verify.mjs` uses only the published round file, Arc RPC and Circle's public Gateway API. It checks the buyer's
signatures, every Merkle proof against the root stored on Arc, that Circle settled every authorization, that the
buyer's Gateway balance fell by exactly its authorizations in each batch, and the delivered count.

## Files

| File | What it does |
|---|---|
| `discover.mjs` → `select.mjs` → `probe.mjs` → `plan.mjs` | list Arc Gateway listings, apply the safety rules, read each unpaid 402, build the purchase plan |
| `run.mjs` | bridge USDC to Arc (CCTP + Forwarding), deploy the ledger once, deposit into Gateway, buy, anchor. Shows everything it will send and waits for `yes` |
| `verify.mjs` | independent verification |
| `build-site.mjs` | results page and per-seller JSON |
| `contracts/DeliveryLedger.sol` | the on-chain ledger (MIT) |

Method and limits: [METHOD.md](METHOD.md). Not affiliated with or endorsed by Circle or Arc.
