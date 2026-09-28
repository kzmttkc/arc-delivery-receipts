# Method

## What is bought
Source: Circle's public x402 Discovery API (`api.circle.com/v2/x402/discovery/resources`), every listing whose
`accepts` include `eip155:5042` with `extra.name = GatewayWalletBatched` (Circle Gateway batched settlement on Arc).

Safety rules, applied before anything is paid (`select.mjs`, reasons published per listing):
- HTTP GET or POST only
- price at most $1.00
- not an endpoint whose own description or path says it changes state (send, create, delete, update, register,
  transfer, order, trade, mint, publish, key management …)
- no path with an unfilled `{placeholder}`; we do not invent ids

Input rule (`probe.mjs`, `plan.mjs`): the request carries only what the seller's own unpaid 402 declares in
`extensions.bazaar.info.input` ("declared"). A GET that needs inputs the seller did not declare, and a POST without a
declared body, are not bought. A failure after payment is then about the seller, not about a guessed input.
Each listing is bought once per round, at the price and `payTo` it quoted in the plan; if either changed, it is skipped.

## What is recorded per purchase
The signed Gateway authorization (`from`, `to`, `value`, `validAfter`, `validBefore`, `nonce`, signature), the request
hash (`sha256("METHOD URL\nBODY")`), the HTTP status, content type, byte length and `sha256` of the response bytes,
the `PAYMENT-RESPONSE` header, and the four checks below. Response bodies are not republished; their hashes are.

## Delivered
All four, each counted separately (a check that does not apply is `n/a` and does not fail):
1. `http2xx` – status 200–299
2. `nonEmpty` – body is not empty, `{}`, `[]` or `null`
3. `mimeMatch` – content type matches the type the listing declares
4. `schemaMatch` – if the listing declares an output object with required keys, those keys are present

Outcomes when not delivered: `rejected_after_payment` (4xx), `server_error` (5xx), `no_response` (timeout or reset),
`empty_body`, `wrong_content_type`, `schema_mismatch`.

## Receipts on Arc
One leaf per paid purchase:
`keccak256(abi.encode(nonce, from, to, value, resourceHash, requestHash, responseHash, delivered))`,
sorted-pair keccak Merkle tree. The root, the number of purchases and the number delivered are written to
`DeliveryLedger.anchor()` on Arc right after the round, before results are published. Only the recorder address can
write, and a round can never be changed.

## Settlement reconciliation
Circle's Gateway API (`gateway-api.circle.com/v1/x402/transfers?nonce=…`, no key needed) returns the batch
settlement tx for each authorization. The buyer uses an address dedicated to this project, so in each settlement tx
its Gateway `totalBalance` must fall by exactly the sum of its authorizations in that tx. Anyone can check this at
`block - 1` and `block` over Arc RPC.

Limit: a seller's credit in a batch is netted with other buyers, so the seller side can be checked only in total,
not per payment.

## Publishing
Seller hosts are labelled Host A, B, … until each has had 72 hours with its own results. Per-`payTo` JSON is
available for lookups before paying. Funding: the purchases are paid by vet402. Circle and Arc have no say in the
results, and Circle-listed sellers are measured by the same rules as everyone else.
