# Method (v1, from round 3)

## What is bought
Source: Circle's public x402 Discovery API (`api.circle.com/v2/x402/discovery/resources`), every listing whose
`accepts` include `eip155:5042` with `extra.name = GatewayWalletBatched` (Circle Gateway batched settlement on Arc).

Safety rules, applied before anything is paid (`select.mjs`, reasons published per listing):
- HTTP GET or POST only
- price at most $1.00
- not an endpoint whose own description or path says it changes state (send, create, delete, update, register,
  transfer, order, trade, mint, publish, key management …)
- no path with an unfilled `{placeholder}`; we do not invent ids

Input rule (`probe.mjs`, `plan.mjs`, `plan3.mjs`): the request carries only values the seller itself declared in
machine-readable form: its unpaid 402 (`extensions.bazaar.info.input`), its Discovery listing, or the input spec in an
uncharged 4xx it returned ("No payment was charged"). A required input is filled only with the seller's own example
value. If a required input has no example, the listing is not bought. We never invent values.
Each listing is bought once per round, at the price and `payTo` it quoted in the plan; if either changed, it is skipped.

## What is recorded per purchase
The signed Gateway authorization (`from`, `to`, `value`, `validAfter`, `validBefore`, `nonce`, signature), the request
hash (`sha256("METHOD URL\nBODY")`), the HTTP status, content type, byte length and `sha256` of the response bytes,
the `PAYMENT-RESPONSE` header, and the four checks below. Response bodies are not republished; their hashes are.

## Checks and verdict
Four checks on what came back, each counted separately (a check that does not apply is `n/a`):
1. `http2xx`: status 200–299
2. `nonEmpty`: the body is not empty. A valid empty result such as `[]` or `{}` passes and is flagged `emptyResult`
3. `mimeMatch`: content type matches the type the listing declares
4. `schemaMatch`: if the listing declares an output object with required keys, those keys are present

Whether the seller charged comes from Circle, not from us: a payment counts as charged when Circle's Gateway API has a
transfer for its nonce. Verdicts:
- charged: `delivered` (all checks pass), `charged_bad_response`, `charged_then_rejected` (4xx), `charged_server_error`,
  `charged_no_response`
- not charged: `refused_not_charged` (4xx without charging, the correct way to refuse a bad request),
  `payment_not_accepted` (402 again), `served_awaiting_settlement` (content returned, no transfer yet, and the signed
  authorization is still valid, so the seller may still settle it), `served_not_charged` (the same after the
  authorization expired), `failed_not_charged`. Verdicts are re-checked after every authorization in a round has expired

Seller-declared prepaid balance: some sellers publish a billing model in which the 402 amount is a top-up and later
calls are deducted from a balance without submitting each authorization to Circle (`data/billing-models.json`, with
the seller's own documentation). A 2xx call to such a seller counts as charged (`paidFrom: prepaid_balance`) when
Circle has settled top-ups from this buyer to the same `payTo` that cover every call so far at the published unit price.

**Delivery rate = delivered / charged.** A seller that refuses a bad request without charging is not penalised.

## Receipts on Arc
One leaf per paid purchase, committing raw facts only (v1):
`keccak256(abi.encode(nonce, from, to, value, resourceHash, requestHash, uint16 httpStatus, responseHash))`,
sorted-pair keccak Merkle tree. The root, the number of paid purchases and the number whose response passed the four checks are written to
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

## History
Rounds 1–2 used method v0. Its leaf also committed a run-time verdict, and v0 treated an uncharged refusal as a failed
delivery and an empty list as an empty body. Both rounds remain published and verifiable as v0. The v1 verdicts for
round 2 are computed from the same records.
