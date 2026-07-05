# Spec: Stripe checkout + order pipeline (deposit model, status page)

## Goal

Replace the fake no-payment order step with a real **30% deposit** collected through
Stripe **hosted Checkout** (redirect — no Stripe.js, no build step), a persistent
order record in Firestore with a status lifecycle
`deposit_pending → deposit_paid → in_production → ready → shipped`, and an order
status page on `orders.html`. Currency: **USD** (matches `#quoteTotal` "… USD").

## Current state

- `submitOrder(e)` (ailab.html ~6032): fake-succeeds after a 1.8 s `setTimeout`,
  order id `'JWLZ-' + String(Date.now()).slice(-6)`, writes
  `users/{uid}/orders` via `JWL.saveOrder` **only if signed in** (silently skips
  otherwise), `status: 'pending'`, `design.price = LAB.quote?.total`. Success panel
  `#sSuccess` (~1617) with `#orderIdDisplay`. Form `#orderForm` (~1524), fields
  `firstName lastName email phone address1 address2 city province postalCode country
  notes`, submit button `#orderSubmitBtn` / `#orderBtnText`. Footer of the form
  already says "Payment collected at confirmation call" (~1606) — copy must change.
- `LAB.quote = { total: r.finalPrice, grams: r.metalGrams }` set in `displayPricing`
  (~5929) from `calculatePrice(metalType, stoneType, jewelryType, userCarats)`
  (~5802). Pricing inputs: metal code (`925silver|10ctgold|14ctgold` — load-bearing,
  never rename), stone code (`moissanite_vvsd`, `lab_diamond`, `real_diamond_vsvvs`/
  `natural_diamond`), `jwlSpecifications.metalGrams` + `totalCarats`, live spot
  prices from `gold-price`/`silver-price` workers (USD/g; hardcoded fallbacks silver
  0.97, 10k 44.24, 14k 61.86).
- `firestore-service.js`: `JWL.saveOrder` uses `addDoc` (random doc id — the
  `JWLZ-…` id is only a field), `JWL.getOrders` reads latest 20. Firebase project
  `jwlzify-193c2`; web config public by design (`firebase-auth.js`).
- `orders.html`: static "Coming Soon" card (~90–95). Already loads
  `firebase-auth.js` + `firestore-service.js` (module scripts, ~167–168) and has the
  header auth UI (`#signInBtn`, `#userMenu`). `account.html` (~270–405) shows the
  house pattern: `getApps().length ? getApp() : initializeApp(cfg)`,
  `onAuthStateChanged` gate, `JWL.getOrders().then(renderOrders)`, status badges
  `status-${status}`.
- **Firestore security rules are not in the repo** — current rules unknown
  (ambiguity flagged; required rules below must be verified/applied in the Firebase
  console).
- Constraints: workers deploy via **dashboard paste only**; secrets in worker
  encrypted vars; front end is plain JS on GitHub Pages (`jwlzify.com`).

## Approach

### Deposit model — 30% at order, balance before shipping

Default: **30% deposit** (rounded to cents), remainder collected when the piece is
`ready` (second Checkout link sent manually for v1). Why 30%: bespoke 4–6-week
commissions need commitment but the brand is pre-launch with zero fulfillment
history — a full-payment wall kills conversion; 30% of a typical quote comfortably
covers raw material cost exposure early (formula: `base = final / 2.2` at the
default 100% profit tier, and materials are a fraction of base), and it keeps the
refund story simple. Floor: if `total × 0.30 < $0.50` (Stripe minimum), charge
$0.50.

### Payment collection — Stripe hosted Checkout via a worker

New Cloudflare Worker **`stripe-checkout`** (dashboard-deployed, secret
`STRIPE_SECRET_KEY`). The browser POSTs order + pricing inputs, the worker
**recomputes the price server-side**, creates a Checkout Session with the Stripe
REST API (form-encoded `fetch` — no npm SDK, works in dashboard paste), and returns
`{url}`; the browser does `location.href = url`. No client-side Stripe.js anywhere.

### Payment confirmation — client polling via worker, NOT a webhook (v1)

**Chosen:** on return to `orders.html?session_id=…`, the client asks the same worker
`GET /session?session_id=…`; the worker retrieves the session from Stripe and
returns `{payment_status, orderId}`; the signed-in client then updates **its own**
order doc to `deposit_paid` (allowed by rules — user owns `users/{uid}/orders`).

**Rejected (v1): `stripe-webhook` worker writing Firestore directly.** A worker has
no Firebase Admin SDK; writing Firestore requires minting a service-account JWT
(RS256 via WebCrypto `importKey`/`sign` on the PKCS8 key stored as a secret),
exchanging it for an access token, then calling the Firestore REST API — ~150 lines
of crypto plumbing pasted into a dashboard, with key rotation handled by hand. It is
the *correct* long-term design (server-authoritative status), and is sketched in
"Future hardening" below, but for v1 the risk/effort trade favors polling because:
**Stripe itself is the authoritative payment record.** A malicious client can set
its own doc to `deposit_paid`, but staff verify payment in the Stripe dashboard
(cross-checked by the stored `stripeSessionId`) before any production work begins —
the doc status is a display cache, not the settlement record. `in_production/ready/
shipped` are set manually via the Firebase console (no admin UI exists).

### Price validation — recompute server-side from inputs, bounded

Client-trusted amounts are unacceptable (`LAB.quote.total` is a JS variable anyone
can edit). Chosen: the client sends the **pricing inputs**, not the price; the
worker mirrors `calculatePrice()` (a third mirror — accepted; the precedent is
`pricing.js`, whose header already documents manual sync) and fetches spot prices
from the existing `gold-price`/`silver-price` workers server-side. Hard bounds
reject nonsense: metal code must be one of the three; stone code in the known set;
`0.5 ≤ metalGrams ≤ 200`; `0 ≤ totalCarats ≤ 50`. The client also sends its
displayed total; if server vs client totals differ by more than **5%** (spot-price
drift window), the worker returns 409 and the client refreshes the quote.
**Residual risk, accepted explicitly:** a tampered client can still under-state
grams/carats within bounds. Exposure is bounded (min ~$0.50-deposit order) and every
order is manually reviewed pre-production; full server-side derivation from raw
per-type specs (pendant mm→grams, bracelet width×length, etc.) is rejected as it
would port half of ailab.html into a worker.

## Step-by-step implementation plan

### 1. New worker: `stripe-checkout-worker.js` (repo reference copy + dashboard paste)

Secrets: `STRIPE_SECRET_KEY`. Copy the CORS block pattern from
`flux-image-worker.js`. Routes:

**POST `/create-session`** — body:

```json
{ "orderId": "JWLZ-123456", "uid": "<firebase uid>", "email": "...",
  "metalType": "925silver", "stoneType": "moissanite_vvsd",
  "metalGrams": 4, "totalCarats": 1.5, "jewelryType": "ring",
  "clientTotal": 123.45 }
```

Worker logic:
1. Validate codes + bounds (§ Approach). Reject unknown fields values with 400.
2. Fetch spot prices (`https://gold-price.sarkd333.workers.dev`,
   `https://silver-price.sarkd333.workers.dev`; on failure use the same hardcoded
   USD/g fallbacks as the front end: silver 0.97, 10k 44.24, 14k 61.86).
3. Recompute: `metalCost = grams × perGram` (silver ×0.925 handled by the silver
   worker feed exactly as the client's `fetchSpotPrices` does — mirror the client's
   `spotPrices` derivation, not the raw formula, so numbers match);
   `stoneCost = carats × rate` (moissanite 2, lab 80, natural/real 2 — mirror
   `getDynamicStoneRates`/`STONE_RATES` incl. the `real_diamond_vsvvs`→default-$2
   quirk, CLAUDE.md Issues #13); labour 20%; profit 100% / 150%
   (925silver+moissanite_vvsd) / 70% (gold+natural or real_diamond_vsvvs);
   `total = base + labour + profit`.
4. `if (Math.abs(total - clientTotal) / total > 0.05) return 409 {serverTotal}`.
5. `depositCents = Math.max(50, Math.round(total * 0.30 * 100))`.
6. Create the session — form-encoded POST to
   `https://api.stripe.com/v1/checkout/sessions` with
   `Authorization: Bearer ${env.STRIPE_SECRET_KEY}`:
   - `mode=payment`
   - `line_items[0][price_data][currency]=usd`
   - `line_items[0][price_data][unit_amount]=<depositCents>`
   - `line_items[0][price_data][product_data][name]=JWLZIFY 30% deposit — <orderId>`
   - `line_items[0][price_data][product_data][description]=Balance of $<total-deposit> due before shipping`
   - `line_items[0][quantity]=1`
   - `customer_email=<email>`, `client_reference_id=<orderId>`
   - `metadata[orderId]`, `metadata[uid]`, `metadata[serverTotal]`
   - `success_url=https://jwlzify.com/orders.html?session_id={CHECKOUT_SESSION_ID}`
   - `cancel_url=https://jwlzify.com/ailab.html?checkout=canceled`
7. Return `{ url: session.url, sessionId: session.id, depositCents, serverTotal }`.

**GET `/session?session_id=cs_…`** — worker calls
`GET https://api.stripe.com/v1/checkout/sessions/<id>`, returns only
`{ payment_status, orderId: session.metadata.orderId, uid: session.metadata.uid,
amount_total }`. Never proxy the whole session object (it contains PII).

### 2. `firestore-service.js` — deterministic doc ids + status update

Add to the import list: `doc, setDoc, updateDoc`. Add:

```js
JWL.saveOrderWithId = async function (orderId, data) {
  const user = window._jwlAuth?.currentUser;
  if (!user) return null;
  try {
    await setDoc(doc(db(), 'users', user.uid, 'orders', orderId),
      { ...data, uid: user.uid, createdAt: serverTimestamp() });
    return orderId;
  } catch (e) { console.error('saveOrderWithId:', e); return null; }
};
JWL.updateOrderStatus = async function (orderId, status, extra) {
  const user = window._jwlAuth?.currentUser;
  if (!user) return false;
  try {
    await updateDoc(doc(db(), 'users', user.uid, 'orders', orderId),
      { status, ...(extra || {}) });
    return true;
  } catch (e) { console.error('updateOrderStatus:', e); return false; }
};
```

Leave `JWL.saveOrder`/`getOrders` untouched (account.html depends on them).

### 3. ailab.html — rewrite `submitOrder` (~6032)

1. **Require sign-in**: `if (!window._jwlAuth?.currentUser) { signInWithGoogle();
   /* restore button */ return; }` — an order that can't be persisted can't be
   paid-for and tracked. (Behavior change: today signed-out orders "succeed"
   into nowhere.)
2. Build the order doc exactly as today (same `design/customer/shipping/notes`
   shape) but `status: 'deposit_pending'`, plus `pricing: { metalType: LAB.material,
   stoneType: LAB.gem, jewelryType: LAB.type, metalGrams:
   window.jwlSpecifications?.metalGrams, totalCarats:
   window.jwlSpecifications?.totalCarats, clientTotal: LAB.quote?.total }` and
   `deposit: { pct: 0.30 }`. Save via `await JWL.saveOrderWithId(orderId, data)`.
3. POST the pricing inputs + `orderId`/`uid`/`email` to
   `https://stripe-checkout.sarkd333.workers.dev/create-session`.
   - 409 → alert "Prices refreshed — please review your quote", call
     `fetchAndUpdatePrices()`, re-enable the button.
   - Other failure → re-enable button, show error text in `#orderBtnText` area.
4. Success → `await JWL.updateOrderStatus(orderId, 'deposit_pending',
   { stripeSessionId: sessionId, depositCents })` then
   `window.location.href = url`. **Delete the fake 1.8 s `setTimeout` success**;
   `#sSuccess` is no longer reached from ailab.html (keep the markup — orders.html
   copy reuses its timeline content conceptually, and removing it is out of scope).
5. Copy changes in `#s6`: button text "Continue to Secure Deposit"; the ~1606 line
   becomes "🔒 30% deposit via Stripe secure checkout · balance due before
   shipping"; `#orderSummaryPrice` shows
   `Deposit today $X · Total $Y` (compute `X = Math.max(0.50, total*0.30)`).
   Note: image URLs — `design.imageUrl = LAB.imageUrl` is a **blob URL** today and
   is dead after the redirect; store `null` (as today's code already tolerates) or,
   if design-save infra exists at implementation time, the saved-design
   `imageDataUrl`. Do not attempt to persist blob URLs.

### 4. orders.html — status page

Replace the "Coming Soon" card (~90–95) with:
- **Auth gate** (account.html pattern ~384–405): signed-out → "Sign in to view your
  orders" button wired to `signInWithGoogle()`.
- **Return-from-Stripe handler** (plain module script): if
  `new URLSearchParams(location.search).get('session_id')` exists →
  `GET <worker>/session?session_id=…` → if `payment_status === 'paid'` and the
  signed-in uid matches the returned `uid`, call
  `JWL.updateOrderStatus(orderId, 'deposit_paid', { paidAt: Date.now() })`
  (idempotent — skip if already past `deposit_pending`), show a green confirmation
  banner with the orderId, then `history.replaceState` the query away.
  If the user isn't signed in yet, run this after `onAuthStateChanged` fires.
- **Order list**: `JWL.getOrders()` → cards: thumbnail-less summary (style/type,
  metal/gem labels, `orderId`, date, `design.price`), status badge, and a 5-step
  progress strip (`deposit_pending → deposit_paid → in_production → ready →
  shipped`; also render a `canceled` badge state). Map today's legacy
  `status: 'pending'` docs to the `deposit_pending` display bucket.
- Keep the page's existing header/footer/scripts; only the `<main>` card and one
  module script change.

### 5. Firestore security rules (Firebase console — verify current rules first)

```
match /users/{uid}/orders/{orderId} {
  allow read, create: if request.auth != null && request.auth.uid == uid;
  allow update: if request.auth != null && request.auth.uid == uid
    // client may only flip deposit_pending → deposit_paid and add payment fields
    && request.resource.data.diff(resource.data).affectedKeys()
         .hasOnly(['status','paidAt','stripeSessionId','depositCents'])
    && resource.data.status == 'deposit_pending'
    && request.resource.data.status in ['deposit_paid','canceled'];
  allow delete: if false;
}
```
`in_production/ready/shipped` are console/Admin-SDK writes (rules don't apply).
Rules cannot verify payment with Stripe — that's the accepted polling trade-off.

### 6. Refunds / cancellation (policy notes, no code in v1)

- Deposit refundable in full until status `in_production` (manual Stripe dashboard
  refund; staff sets status `canceled`).
- After production starts: bespoke items — deposit non-refundable; align the copy
  with `returns.html` at implementation time (that page's current claims predate
  this feature; do not silently contradict it).
- Balance payment (status `ready`): v1 = manually created Stripe Payment Link for
  `total − deposit`, sent by email. v2 candidate: a "Pay balance" button on
  orders.html hitting `/create-session` with a `phase: 'balance'` flag.

## Integration points

- `LAB.quote` (~5929) remains display-only; the worker never trusts it beyond the
  ±5% cross-check.
- Metal/stone codes cross three systems (client, worker, Firestore) — codes are
  frozen (`925silver/10ctgold/14ctgold`); display formatting stays client-side.
- `account.html` `renderOrders` already renders `status-${status}` badges — add CSS
  classes for the new statuses there too (display-only tweak).
- Worker mirrors: `stripe-checkout-worker.js` pricing block joins `pricing.js` as a
  manual mirror of `calculatePrice` — add the same "keep in sync" header comment.
- GitHub Pages: success/cancel URLs are plain page loads on `jwlzify.com`; no
  server routing needed.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Client fakes `deposit_paid` in its own doc | Stripe is the settlement record; staff cross-check `stripeSessionId` in Stripe dashboard before production; rules restrict which fields/transition the client may write |
| Client under-states grams/carats (within bounds) | Bounds + manual pre-production review; explicit accepted residual risk; metadata stores `serverTotal` for audit |
| Spot-price drift between quote and checkout | ±5% tolerance + 409 refresh path |
| User pays but closes the tab before returning to orders.html | Doc stays `deposit_pending`; orders.html re-runs the session check on next visit **only with session_id** — mitigation: also let staff reconcile from Stripe dashboard; v2 webhook fixes this class entirely |
| Worker secret misconfig | Same `if (!env.STRIPE_SECRET_KEY) return 500` guard pattern as flux worker |
| Double-payment (user re-submits) | `submitOrder` disables the button until redirect; sessions are per-orderId; a re-submission creates a new orderId (Date.now-based) — acceptable; Stripe dashboard shows dupes for manual refund |
| Firestore rules currently unknown/possibly open | Rules audit is a **blocking precondition** of this feature — flagged explicitly |
| Legacy `status:'pending'` docs | Mapped to `deposit_pending` in display code only; no migration |

### Future hardening (v2, out of scope): `stripe-webhook` worker

Dashboard-deployed worker with secrets `STRIPE_WEBHOOK_SECRET`,
`FIREBASE_SA_EMAIL`, `FIREBASE_SA_PRIVATE_KEY`. Verify `Stripe-Signature` (HMAC
SHA-256 of `t.payload` via WebCrypto, constant-time compare, 5-min tolerance) on
`checkout.session.completed`; mint a service-account JWT (RS256 WebCrypto sign,
scope `https://www.googleapis.com/auth/datastore`), exchange at
`oauth2.googleapis.com/token`, then `PATCH
https://firestore.googleapis.com/v1/projects/jwlzify-193c2/databases/(default)/documents/users/{uid}/orders/{orderId}?updateMask.fieldPaths=status`.
This makes `deposit_paid` server-authoritative and closes the closed-tab and
fake-status gaps; rules then remove the client `update` grant.

## Test plan (manual, Stripe **test mode**)

Setup: create Stripe test keys; set `STRIPE_SECRET_KEY` (test key) in the worker;
point the front end at the worker URL. Test card `4242 4242 4242 4242`, any future
expiry/CVC.

1. **Happy path**: sign in → design → quote → order form → "Continue to Secure
   Deposit" → Stripe hosted page shows `JWLZIFY 30% deposit — JWLZ-…` at exactly
   `round(total×0.30)` → pay with 4242 → land on
   `orders.html?session_id=…` → green banner, order card shows `deposit_paid`;
   Firestore doc has `stripeSessionId`, `paidAt`; Stripe dashboard shows the
   payment with matching `metadata.orderId`.
2. **Cancel path**: click back/cancel on Stripe → `ailab.html?checkout=canceled` →
   order remains `deposit_pending`, visible on orders.html with a "complete your
   deposit" hint (v1: static text is fine).
3. **Signed-out order**: submit while signed out → sign-in modal appears, no
   Firestore write, no Stripe call.
4. **Tamper test**: in DevTools set `LAB.quote.total = 1` before submitting →
   worker 409 → quote refresh message; set `jwlSpecifications.metalGrams = 9999` →
   worker 400.
5. **Price recompute parity**: for each metal×stone combo (925silver+moissanite,
   10ctgold+lab, 14ctgold+real/natural), compare `serverTotal` in the worker
   response metadata to `#quoteTotal` — must match within tolerance (log both).
6. **Declined card** (`4000 0000 0000 0002`): Stripe blocks; retry succeeds; no
   status change until paid.
7. **Status lifecycle**: via Firebase console set the doc to `in_production`,
   `ready`, `shipped` — orders.html progress strip advances; client attempt to
   `updateOrderStatus(orderId,'shipped')` from DevTools is **denied** by rules.
8. **Legacy doc**: hand-create a doc with `status:'pending'` → renders as
   Deposit Pending, no console errors.
9. **Session-check idempotency**: reload `orders.html?session_id=…` three times →
   status stays `deposit_paid`, no duplicate banners/writes.
10. Mobile smoke test: hosted Checkout on a phone viewport, return redirect lands
    correctly on orders.html.
