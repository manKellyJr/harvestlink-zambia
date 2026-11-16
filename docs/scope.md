# Scope: Milestone 1 — Marketplace core

This is the single source of truth for what the MVP does. Update it in the same pull request as any change in scope.

## Objective

Prove the core loop for one crop in one province: a farmer lists produce by USSD, it is bulked at a collection point, a buyer orders it, a transporter moves it, and the buyer pays the farmer's mobile money wallet on delivery. It is built on the market research recommendations (Nov 2026):

- **Faster payment than FRA** is the wedge: farmers are paid on delivery, not months later.
- **Bulking at known collection points** makes a truck trip worth it for small lots.
- **One non-maize crop** where FRA barely buys. Default: soybeans, configurable with `PILOT_CROP`.
- **USSD and SMS** for farmers and transporters (any phone, no data); web for buyers.
- **HarvestLink never holds customer money** in v1, so no Bank of Zambia e-money licence is needed yet.
- **Pilot geography:** Central Province (`PILOT_PROVINCE`), with placeholder collection points in Mkushi, Chibombo and Kabwe.

## Acceptance criteria

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | A farmer can register over USSD with explicit data-protection consent, choosing their wallet provider | Done | `tests/ussd.test.ts` |
| 2 | A farmer can list a lot (quantity, collection point, minimum price) and see their lots | Done | `tests/ussd.test.ts` |
| 3 | A buyer can register and log in on the web with a one-time SMS code | Done | `tests/otp.test.ts`, browser smoke test |
| 4 | Buyers see bulked supply per collection point without seeing individual farmers | Done | `supplyByCollectionPoint` |
| 5 | An order reserves supply atomically from the oldest lots whose minimum price is at or below the offer, or fails with the available amount | Done | `tests/domain.test.ts` |
| 6 | Transporters in the district are notified and can accept and mark pickup over USSD | Done | `tests/ussd.test.ts` |
| 7 | On delivery, one payout per farmer (kg × price) and one for the transporter are created with the payee's wallet | Done | `tests/domain.test.ts` |
| 8 | Buyer records the mobile money transaction ID; payee confirms or disputes over USSD; order completes when all are confirmed | Done | `tests/domain.test.ts` |
| 9 | A buyer can cancel before pickup and the produce returns to the farmers' lots | Done | `tests/domain.test.ts` |
| 10 | Every state change is in an append-only audit log; every SMS is in an outbox | Done | `audit_events`, `sms_outbox` tables |
| 11 | Role checks on every action (farmer / buyer / transporter / admin) | Done | `requireRole` in every domain function |

## Implemented, partial, outstanding

**Implemented:** everything in the table above, CI (typecheck, tests, build), dev/staging/production configuration.

**Partially implemented:**
- *SMS delivery:* the Africa's Talking integration is written but not yet tested against a live account. Failed sends are recorded as `failed` in `sms_outbox` but are not retried automatically yet.
- *Disputes:* a dispute notifies the buyer and is recorded, but there is no admin screen to resolve it.
- *Collection points:* seeded from a script; no admin screen to manage them.

**Outstanding (not started):**
- Admin console (users, collection points, disputes, suspending accounts).
- Quality and weight at the collection point (grading, weighed kg differing from listed kg).
- Payment through a licensed aggregator (buyer pays once, aggregator disburses to each wallet) to remove manual transfers.
- Input suppliers (seed, fertiliser) — deliberately left for a later milestone.
- Local language menus (Bemba, Nyanja, Tonga).
- Privacy notice page and Data Protection Commissioner registration (business task, needed before the pilot).

## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Buyer does not pay farmers after delivery | Farmers lose trust in the platform; the whole wedge fails | Every payout is tracked, farmers can dispute, buyers are vetted at onboarding. Next: buyer deposit or aggregator collection before dispatch. |
| Side-selling: farmer sells reserved produce elsewhere | Truck arrives to a short load | Collection point check-in of physical stock (next milestone); track farmer reliability. |
| Quality/weight disputes at delivery | Payment disputes | Add weigh-in and grade at collection point before allocation is final. |
| USSD session timeouts (about 180 s) on long flows | Farmers drop off | Menus are short and stateless; a dropped session restarts safely. |
| Number portability means prefix ≠ network | Payment to the wrong wallet type | Farmers choose their wallet explicitly at registration. |
| Collection point names are placeholders | Pilot cannot start | Agree real sites with farmer groups and update the seed. |

## Next milestone (proposal)

**Milestone 2 — Pilot readiness:** admin console (collection points, users, disputes), collection-point check-in with weighed kg and grade, automatic SMS retry, privacy notice page, and a live Africa's Talking sandbox test with a real USSD code. Deploy to Vercel with Neon Postgres for a staging environment.
