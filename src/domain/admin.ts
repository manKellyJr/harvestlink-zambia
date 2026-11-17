/**
 * Admin operations: collection points, accounts, disputes and an overview.
 * Every function checks the admin role itself, so no page can bypass it.
 */
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { Db } from "@/db/client";
import { collectionPoints, lots, orders, payouts, smsOutbox, users, type Role } from "@/db/schema";
import { DomainError } from "./errors";
import { requireRole, findUserByPhone } from "./users";
import { normalisePhone } from "./phone";
import { audit } from "./audit";
import { pilot } from "./config";
import { formatKwacha } from "./money";
import { completeOrderIfSettled } from "./payouts";
import { sendSms } from "@/sms";

export async function overview(db: Db, adminId: number) {
  await requireRole(db, adminId, "admin");
  const count = <T extends string>(rows: { key: T; n: number }[]) => Object.fromEntries(rows.map((r) => [r.key, r.n])) as Record<T, number>;
  const [byRole, lotsByStatus, ordersByStatus, paid, failedSms] = await Promise.all([
    db.select({ key: users.role, n: sql<number>`count(*)::int` }).from(users).groupBy(users.role),
    db.select({ key: lots.status, n: sql<number>`count(*)::int` }).from(lots).groupBy(lots.status),
    db.select({ key: orders.status, n: sql<number>`count(*)::int` }).from(orders).groupBy(orders.status),
    db
      .select({ ngwee: sql<number>`coalesce(sum(${payouts.amountNgwee}), 0)::bigint` })
      .from(payouts)
      .where(and(eq(payouts.status, "confirmed"), eq(payouts.payeeType, "farmer"))),
    db.select({ n: sql<number>`count(*)::int` }).from(smsOutbox).where(eq(smsOutbox.status, "failed")),
  ]);
  return {
    users: count(byRole),
    lots: count(lotsByStatus),
    orders: count(ordersByStatus),
    farmerPaymentsConfirmedNgwee: Number(paid[0].ngwee),
    failedSms: failedSms[0].n,
  };
}

const cpInput = z.object({
  name: z.string().trim().min(3, "Name is too short").max(80),
  district: z.string().trim().min(2, "Enter a district").max(40),
  description: z.string().trim().max(200).optional(),
});

export async function createCollectionPoint(db: Db, adminId: number, input: z.input<typeof cpInput>) {
  await requireRole(db, adminId, "admin");
  const parsed = cpInput.safeParse(input);
  if (!parsed.success) throw new DomainError(parsed.error.issues[0].message);
  const [cp] = await db
    .insert(collectionPoints)
    .values({ ...parsed.data, description: parsed.data.description || null, province: pilot.province })
    .returning();
  await audit(db, { actorId: adminId, action: "collection_point.create", entity: "collection_point", entityId: cp.id, details: parsed.data });
  return cp;
}

export async function setCollectionPointActive(db: Db, adminId: number, id: number, active: boolean) {
  await requireRole(db, adminId, "admin");
  const [cp] = await db.update(collectionPoints).set({ active }).where(eq(collectionPoints.id, id)).returning();
  if (!cp) throw new DomainError("Collection point not found");
  await audit(db, { actorId: adminId, action: active ? "collection_point.activate" : "collection_point.deactivate", entity: "collection_point", entityId: id });
}

export async function listUsers(db: Db, adminId: number, filter: { role?: Role; q?: string } = {}) {
  await requireRole(db, adminId, "admin");
  const q = filter.q?.trim();
  return db
    .select({ user: users, collectionPoint: collectionPoints.name })
    .from(users)
    .leftJoin(collectionPoints, eq(users.collectionPointId, collectionPoints.id))
    .where(
      and(
        filter.role ? eq(users.role, filter.role) : undefined,
        q ? or(ilike(users.name, `%${q}%`), ilike(users.phone, `%${q.replace(/^0/, "")}%`)) : undefined,
      ),
    )
    .orderBy(desc(users.createdAt))
    .limit(100);
}

export async function setUserActive(db: Db, adminId: number, userId: number, active: boolean) {
  await requireRole(db, adminId, "admin");
  if (userId === adminId) throw new DomainError("You cannot suspend your own account");
  const [u] = await db.update(users).set({ active }).where(eq(users.id, userId)).returning();
  if (!u) throw new DomainError("User not found");
  await audit(db, { actorId: adminId, action: active ? "user.reactivate" : "user.suspend", entity: "user", entityId: userId });
}

const staffInput = z.object({
  phone: z.string(),
  name: z.string().trim().min(2, "Name is too short").max(60),
  role: z.enum(["agent", "admin", "buyer"]),
  district: z.string().trim().max(40).optional(),
  collectionPointId: z.number().int().positive().optional(),
  walletProvider: z.enum(["mtn", "airtel", "zamtel"]).optional(),
});

/**
 * Create an account on someone's behalf: collection point agents, other admins,
 * or buyers vetted in person. They must still log in with an SMS code sent to
 * the number, so a mistyped number cannot be used by anyone else.
 */
export async function createAccount(db: Db, adminId: number, input: z.input<typeof staffInput>) {
  await requireRole(db, adminId, "admin");
  const parsed = staffInput.safeParse(input);
  if (!parsed.success) throw new DomainError(parsed.error.issues[0].message);
  const v = parsed.data;
  const phone = normalisePhone(v.phone);
  if (await findUserByPhone(db, phone)) throw new DomainError("This number is already registered");
  let district = v.district || null;
  if (v.role === "agent") {
    if (!v.collectionPointId) throw new DomainError("Choose the agent's collection point");
    const [cp] = await db.select().from(collectionPoints).where(eq(collectionPoints.id, v.collectionPointId));
    if (!cp) throw new DomainError("Collection point not found");
    district = cp.district;
  }
  const [u] = await db
    .insert(users)
    .values({
      phone,
      name: v.name,
      role: v.role,
      district,
      collectionPointId: v.role === "agent" ? v.collectionPointId : null,
      walletProvider: v.walletProvider ?? null,
    })
    .returning();
  await audit(db, { actorId: adminId, action: "user.create", entity: "user", entityId: u.id, details: { role: v.role } });
  await sendSms(db, phone, `HarvestLink: an account was created for you as ${v.role}. Log in on the HarvestLink website with this number.`);
  return u;
}

export async function listDisputes(db: Db, adminId: number) {
  await requireRole(db, adminId, "admin");
  const buyer = alias(users, "buyer");
  return db
    .select({ payout: payouts, payeeName: users.name, buyerName: buyer.name, buyerPhone: buyer.phone })
    .from(payouts)
    .innerJoin(users, eq(payouts.payeeId, users.id))
    .innerJoin(orders, eq(payouts.orderId, orders.id))
    .innerJoin(buyer, eq(orders.buyerId, buyer.id))
    .where(eq(payouts.status, "disputed"))
    .orderBy(payouts.updatedAt);
}

/**
 * Resolve a disputed payment after checking with both sides (and, where needed,
 * the mobile money operator's statement):
 * - "paid": the money did arrive; the payout is confirmed.
 * - "reopen": it did not; the buyer is asked to pay again and the payout goes back to "owed".
 */
export async function resolveDispute(db: Db, adminId: number, payoutId: number, outcome: "paid" | "reopen", note: string) {
  await requireRole(db, adminId, "admin");
  if (note.trim().length < 5) throw new DomainError("Write a short note on how this was checked");
  const [p] = await db
    .update(payouts)
    .set({ status: outcome === "paid" ? "confirmed" : "owed", updatedAt: new Date() })
    .where(and(eq(payouts.id, payoutId), eq(payouts.status, "disputed")))
    .returning();
  if (!p) throw new DomainError("This payment is not in dispute");
  await audit(db, { actorId: adminId, action: `payout.dispute_${outcome}`, entity: "payout", entityId: payoutId, details: { note: note.trim() } });
  const [o] = await db.select().from(orders).where(eq(orders.id, p.orderId));
  const [b] = await db.select().from(users).where(eq(users.id, o.buyerId));
  if (outcome === "paid") {
    await sendSms(db, p.walletPhone, `HarvestLink: we checked payment of ${formatKwacha(p.amountNgwee)} for order #${o.id} and confirmed it reached your wallet.`);
    await completeOrderIfSettled(db, o.id);
  } else {
    await sendSms(db, b.phone, `HarvestLink: payment of ${formatKwacha(p.amountNgwee)} to ${p.walletPhone} for order #${o.id} did not arrive. Please pay and record the new transaction ID.`);
  }
}
