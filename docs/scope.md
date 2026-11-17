# Scope: MVP (Milestones 1 and 2)

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
| 2 | A farmer can register a lot (declared kg, collection point, minimum price) and see their lots | Done | `tests/ussd.test.ts` |
| 3 | A collection point agent weighs and grades (A/B) or rejects each lot; only weighed lots are offered, and payment uses the weighed kg | Done | `tests/milestone2.test.ts` |
| 4 | Agents can only check in at their own collection point; each lot is checked in once | Done | `tests/milestone2.test.ts` |
| 5 | Buyers register and log in with a one-time SMS code; see bulked supply per point, including grade A kg | Done | `tests/otp.test.ts`, browser run |
| 6 | An order reserves weighed supply atomically from the oldest lots meeting the price and grade, or fails with the available amount | Done | `tests/domain.test.ts`, `tests/milestone2.test.ts` |
| 7 | Transporters in the district are notified and can accept and mark pickup over USSD | Done | `tests/ussd.test.ts` |
| 8 | On delivery, one payout per farmer (weighed kg × price) and one for the transporter are created with the payee's wallet | Done | `tests/domain.test.ts` |
| 9 | Buyer records the transaction ID; payee confirms or disputes over USSD; order completes when all are confirmed | Done | `tests/domain.test.ts` |
| 10 | Admin resolves disputes (payment arrived / buyer must pay again) with a required note | Done | `tests/milestone2.test.ts` |
| 11 | Admin manages collection points and accounts (creates agents, admins and vetted buyers; suspends and reactivates) | Done | `tests/milestone2.test.ts`, browser run |
| 12 | Admin overview: people, lots, orders, confirmed farmer payments, failed SMS | Done | `/admin` |
| 13 | Failed SMS are retried automatically (up to 4 attempts, within 24 h) | Done | `tests/milestone2.test.ts` |
| 14 | A buyer can cancel before pickup and the produce returns to the farmers' lots | Done | `tests/domain.test.ts` |
| 15 | Every state change is in an append-only audit log; every SMS is in an outbox | Done | `audit_events`, `sms_outbox` |
| 16 | Role checks in every action (farmer, buyer, transporter, agent, admin); suspended accounts are blocked everywhere | Done | `requireRole`, tests |
| 17 | Privacy notice published at `/privacy` | Done (draft, needs legal review) | `/privacy` |
| 18 | Live test against Africa's Talking sandbox | Waiting on owner's accounts | [go-live.md](go-live.md) |

## Implemented, partial, outstanding

**Implemented:** everything marked Done above; CI (typecheck, tests, build); migrations applied automatically on each Vercel deploy; first-admin bootstrap for a fresh deployment.

**Partially implemented:**
- *Africa's Talking:* the SMS and USSD integrations are written to the provider's API but have not been run against a real account yet (criterion 18).
- *Privacy notice:* drafted, not legally reviewed.

**Outstanding (deliberately not in the MVP):**
- Payment through a licensed aggregator (buyer pays once, aggregator disburses to each wallet).
- Input suppliers (seed, fertiliser).
- Local language menus (Bemba, Nyanja, Tonga).
- Reports and exports (CSV of payments, farmer statements).
- Offline mode for agents at points without signal (today the agent page needs a connection).

## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Buyer does not pay farmers after delivery | Farmers lose trust in the platform; the whole wedge fails | Every payout is tracked, farmers can dispute, buyers are vetted at onboarding. Next: buyer deposit or aggregator collection before dispatch. |
| Side-selling: farmer sells weighed produce elsewhere before pickup | Truck arrives to a short load | Only weighed produce is offered and it must stay at the collection point; agents can see what is there. Next: record pickup weight. |
| Quality/weight disputes at delivery | Payment disputes | Weighed and graded by an agent in front of the farmer; buyer can require grade A. |
| Agent fraud (false weights) | Farmers underpaid or buyers overcharged | Declared vs weighed kg is kept and audited; admins can review large differences. Next: flag automatically. |
| USSD session timeouts (about 180 s) on long flows | Farmers drop off | Menus are short and stateless; a dropped session restarts safely. |
| Number portability means prefix ≠ network | Payment to the wrong wallet type | Farmers choose their wallet explicitly at registration. |
| Collection point names in the demo seed are placeholders | Pilot cannot start | Admin adds the real sites in the console. |

## Next milestone (proposal)

**Milestone 3 — Pilot launch:** run the sandbox test end to end (go-live.md), apply for the live USSD code and sender ID, register with the Data Protection Commissioner, onboard the first collection point with real farmers, then add pickup weighing and CSV exports based on what the first weeks show.
