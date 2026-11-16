# HarvestLink Zambia

A commerce and fulfilment platform that lets smallholder farmers sell produce to bulk buyers, with transport arranged and payment made straight to the farmer's mobile money wallet on delivery.

**Status:** Milestone 1 (marketplace core) — see [docs/scope.md](docs/scope.md) for what is built, what is not, and why.

## How it works

1. **Farmers** dial a USSD code on any phone, register, and list a lot (e.g. 300 kg of soybeans) at a nearby collection point with the lowest price they accept.
2. **Buyers** log in to the website with an SMS code, see bulked supply per collection point and place an order at their price. Supply is reserved immediately from the oldest eligible lots.
3. **Transporters** in that district get an SMS, accept the job over USSD, and mark it picked up.
4. The **buyer** confirms delivery. HarvestLink then shows exactly what the buyer owes each farmer and the transporter, and to which MTN, Airtel or Zamtel wallet.
5. The buyer pays each wallet directly and enters the transaction ID; each farmer confirms receipt over USSD. When everyone confirms, the order is complete.

HarvestLink never receives or holds money in this version.

## Stack

| Part | Choice | Why |
| --- | --- | --- |
| Web app + API | Next.js 16 (TypeScript), server-rendered | One codebase for buyer pages, USSD webhook and APIs; pages work on slow connections without heavy JavaScript. Hosts on Vercel. |
| Database | PostgreSQL via Drizzle ORM, SQL migrations in `drizzle/` | Relational data with transactions for stock allocation. Neon Postgres in staging/production; embedded PGlite locally (no install). |
| USSD + SMS | Africa's Talking | One integration reaches MTN, Airtel and Zamtel subscribers. |
| Tests | Vitest against a real in-memory Postgres | Tests exercise the real SQL and migrations, not mocks. |

Full reasoning in [docs/decisions.md](docs/decisions.md).

## Running locally

Requires Node 20+.

```bash
npm install
cp .env.example .env.local   # defaults work for local development
npm run db:seed              # pilot collection points + demo accounts
npm run dev                  # http://localhost:3000
```

- Buyer login: phone `0970000010`. SMS messages (including the login code) are printed in the terminal.
- Try the USSD menu without a phone:

```bash
curl -X POST localhost:3000/api/ussd --data-urlencode "phoneNumber=+260970000001" --data-urlencode "text="
curl -X POST localhost:3000/api/ussd --data-urlencode "phoneNumber=+260970000001" --data-urlencode "text=1*1*200*10*1"
```

`text` is the sequence of menu choices joined with `*`, exactly as the USSD gateway sends it.

## Commands

| Command | What it does |
| --- | --- |
| `npm test` | Run all tests |
| `npm run typecheck` | TypeScript check |
| `npm run db:generate` | Create a migration after changing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations (uses `DATABASE_URL` when set) |
| `npm run db:seed` | Seed collection points (demo users only outside production) |

## Environments

| | Development | Staging | Production |
| --- | --- | --- | --- |
| Database | PGlite in `.pglite/` | Neon branch (`DATABASE_URL`) | Neon main (`DATABASE_URL`) |
| SMS / USSD | Console log | Africa's Talking sandbox | Africa's Talking live |
| Hosting | `npm run dev` | Vercel preview deployments | Vercel production |

The app refuses to start in production without `DATABASE_URL` and `SESSION_SECRET`, refuses the console SMS provider on Vercel production, and rejects USSD requests without `USSD_WEBHOOK_KEY`.

## Code layout

```
app/            Next.js pages, server actions and API routes (thin: no business rules)
src/domain/     Business rules: users, lots, orders, payouts, prices (all validation and RBAC here)
src/ussd/       USSD menu engine
src/sms/        SMS outbox + providers
src/auth/       SMS login codes and signed sessions
src/db/         Schema and connection
drizzle/        SQL migrations
tests/          Automated tests
docs/           Scope, decisions, risks
```
