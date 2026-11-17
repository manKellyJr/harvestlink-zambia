# Architecture decisions

Short records of the decisions that shape the system. Add a new entry rather than editing an old one when a decision changes.

## 1. One Next.js application, not separate frontend and backend services
**Decision:** a single TypeScript Next.js app serves the buyer website, the USSD webhook and the server logic, deployed on Vercel.
**Why:** one deployable unit is cheapest to run and simplest for a small team. Business rules live in `src/domain/` with no dependency on Next.js, so they can move to a separate service later if needed.
**Trade-off:** serverless functions have cold starts; USSD gateways allow a few seconds per response, which is enough. Revisit if response times exceed 2 s.

## 2. PostgreSQL with Drizzle and SQL migrations
**Decision:** PostgreSQL (Neon in staging/production), Drizzle ORM, versioned SQL migrations in `drizzle/`. Local development and tests use PGlite, the real Postgres engine compiled to WebAssembly.
**Why:** order allocation needs row locking and transactions so two buyers can never buy the same kilogram. Using PGlite means tests run against real Postgres with the real migrations, with no Docker or database install.

## 3. Money as integer ngwee
**Decision:** all amounts are stored and calculated as integer ngwee (K1 = 100 ngwee).
**Why:** floating point rounding errors are unacceptable in farmer payments.

## 4. HarvestLink does not hold funds (v1)
**Decision:** the buyer pays each farmer and the transporter directly from their own wallet. HarvestLink records what is owed, the buyer's transaction ID and the payee's confirmation.
**Why:** holding customer funds requires Bank of Zambia authorisation as a payment system business. Direct payment lets the pilot start legally and cheaply.
**Trade-off:** manual transfers are slower for buyers with many farmers and payment is not guaranteed. The planned next step is a licensed aggregator that collects once from the buyer and disburses to each wallet, with HarvestLink still never holding the money.

## 5. USSD and SMS through Africa's Talking
**Decision:** farmers and transporters use USSD; notifications go by SMS; both via Africa's Talking.
**Why:** works on any phone without data, reaches all three networks (MTN, Airtel, Zamtel) through one contract.
**Design:** the USSD engine is stateless. It rebuilds the screen from the input path on every request, so dropped sessions are harmless. The webhook is protected by a shared key because the gateway does not sign requests.

## 6. SMS one-time codes instead of passwords for buyers
**Decision:** buyers log in with a 6-digit SMS code; sessions are HMAC-signed cookies.
**Why:** no passwords to store or reset. Codes are stored hashed, expire after 10 minutes, allow 5 attempts, and are limited to 3 per 15 minutes per number.

## 7. Bulking by allocation, not by batch
**Decision:** an order reserves kilograms from many lots at one collection point (oldest first, only lots whose minimum price is at or below the offer). Lots can be split across orders.
**Why:** farmers keep control of their minimum price, buyers get one large consignment, and fair first-come ordering is easy to explain to farmer groups.

## 8. Weigh-in by HarvestLink agents at the collection point
**Decision:** a lot is offered to buyers only after an agent (a HarvestLink field officer assigned to one collection point) weighs and grades it on the agent web page. Payment uses the weighed kg, never the farmer's USSD estimate.
**Why:** this removes the two biggest delivery disputes (short weight and poor quality) before money is involved, and it confirms the produce is physically at the point, which reduces side-selling.
**Trade-off:** each collection point needs an agent with a phone and a scale on collection days. The agent page is plain server-rendered HTML so it works on low-end Android phones.

## 9. Operating a deployment without local database access
**Decision:** migrations run in the Vercel build (`vercel-build`); the first admin is created by logging in with `BOOTSTRAP_ADMIN_PHONE`; collection points and staff are managed in the admin console.
**Why:** the owner never needs a database password on their own computer, and every production change goes through an audited screen.
