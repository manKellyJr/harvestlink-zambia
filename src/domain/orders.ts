/**
 * Order lifecycle: allocate bulked supply -> transporter accepts -> picked up ->
 * buyer confirms delivery -> buyer pays each farmer's wallet directly -> payees
 * confirm -> completed.
 */
import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { allocations, collectionPoints, lots, orders, payouts, users, type Grade, type Order } from "@/db/schema";
import { DomainError } from "./errors";
import { limits, pilot } from "./config";
import { requireRole } from "./users";
import { audit } from "./audit";
import { formatKwacha } from "./money";
import { walletLabels } from "./phone";
import { sendSms } from "@/sms";

type Notice = { phone: string; body: string };

async function notify(db: Db, notices: Notice[]) {
  for (const n of notices) await sendSms(db, n.phone, n.body);
}

export interface PlaceOrderInput {
  collectionPointId: number;
  quantityKg: number;
  pricePerKgNgwee: number;
  transportFeeNgwee: number;
  deliveryAddress: string;
  /** "B" (default) accepts grade A and B lots; "A" accepts grade A only. */
  minGrade?: Grade;
}

/**
 * A buyer orders bulked produce from one collection point. Supply is reserved
 * immediately from the oldest eligible lots (farmer minimum price <= offered
 * price). The order fails if there is not enough supply, so buyers never wait
 * on an order that cannot be filled.
 */
export async function placeOrder(db: Db, buyerId: number, input: PlaceOrderInput): Promise<Order> {
  await requireRole(db, buyerId, "buyer");
  const { collectionPointId, quantityKg, pricePerKgNgwee, transportFeeNgwee } = input;
  const deliveryAddress = input.deliveryAddress.trim();
  const minGrade: Grade = input.minGrade ?? "B";
  if (minGrade !== "A" && minGrade !== "B") throw new DomainError("Choose grade A or B");
  if (!Number.isInteger(quantityKg) || quantityKg < limits.minLotKg || quantityKg > limits.maxOrderKg) {
    throw new DomainError(`Order between ${limits.minLotKg} and ${limits.maxOrderKg} kg`);
  }
  if (!Number.isInteger(pricePerKgNgwee) || pricePerKgNgwee <= 0 || pricePerKgNgwee > limits.maxPricePerKgNgwee) {
    throw new DomainError("Enter a valid price per kg");
  }
  if (!Number.isInteger(transportFeeNgwee) || transportFeeNgwee < 0) throw new DomainError("Enter a valid transport fee");
  if (deliveryAddress.length < 5) throw new DomainError("Enter a delivery address");

  const notices: Notice[] = [];
  const order = await db.transaction(async (tx) => {
    const [cp] = await tx.select().from(collectionPoints).where(eq(collectionPoints.id, collectionPointId));
    if (!cp || !cp.active) throw new DomainError("Collection point not found");

    const candidates = await tx
      .select({ lot: lots, farmerPhone: users.phone })
      .from(lots)
      .innerJoin(users, eq(lots.farmerId, users.id))
      .where(
        and(
          eq(lots.collectionPointId, collectionPointId),
          eq(lots.crop, pilot.crop),
          eq(lots.status, "listed"),
          gt(lots.availableKg, 0),
          sql`${lots.minPricePerKgNgwee} <= ${pricePerKgNgwee}`,
          minGrade === "A" ? eq(lots.grade, "A") : undefined,
        ),
      )
      .orderBy(asc(lots.createdAt), asc(lots.id))
      .for("update", { of: lots });

    const total = candidates.reduce((s, c) => s + c.lot.availableKg, 0);
    if (total < quantityKg) {
      throw new DomainError(
        `Only ${total} kg${minGrade === "A" ? " of grade A" : ""} available at ${cp.name} for ${formatKwacha(pricePerKgNgwee)}/kg or less`,
      );
    }

    const [o] = await tx
      .insert(orders)
      .values({ buyerId, collectionPointId, crop: pilot.crop, quantityKg, pricePerKgNgwee, minGrade, transportFeeNgwee, deliveryAddress })
      .returning();

    let remaining = quantityKg;
    for (const { lot, farmerPhone } of candidates) {
      if (remaining === 0) break;
      const take = Math.min(remaining, lot.availableKg);
      remaining -= take;
      const left = lot.availableKg - take;
      await tx
        .update(lots)
        .set({ availableKg: left, status: left === 0 ? "sold_out" : "listed" })
        .where(eq(lots.id, lot.id));
      await tx.insert(allocations).values({ orderId: o.id, lotId: lot.id, quantityKg: take });
      notices.push({
        phone: farmerPhone,
        body: `HarvestLink: a buyer reserved ${take}kg of your lot #${lot.id} at ${formatKwacha(pricePerKgNgwee)}/kg (${formatKwacha(take * pricePerKgNgwee)}). Keep it ready at ${cp.name}. You are paid to your wallet on delivery.`,
      });
    }

    const transporters = await tx
      .select({ phone: users.phone })
      .from(users)
      .where(and(eq(users.role, "transporter"), eq(users.active, true), sql`lower(${users.district}) = lower(${cp.district})`));
    for (const t of transporters) {
      notices.push({
        phone: t.phone,
        body: `HarvestLink job #${o.id}: ${quantityKg}kg from ${cp.name} to ${deliveryAddress}. Fee ${formatKwacha(transportFeeNgwee)}. Dial the HarvestLink USSD code > Jobs to accept.`,
      });
    }

    await audit(tx, { actorId: buyerId, action: "order.place", entity: "order", entityId: o.id, details: input });
    return o;
  });
  await notify(db, notices);
  return order;
}

/** Move an order between states atomically. Returns the order or throws if the transition is not allowed. */
async function transition(
  db: Db,
  orderId: number,
  from: Order["status"],
  to: Order["status"],
  guard: ReturnType<typeof eq> | undefined,
  set: Partial<typeof orders.$inferInsert> = {},
): Promise<Order> {
  const [o] = await db
    .update(orders)
    .set({ status: to, ...set })
    .where(and(eq(orders.id, orderId), eq(orders.status, from), guard))
    .returning();
  if (!o) throw new DomainError(`Order #${orderId} is not available for this action`);
  return o;
}

export async function cancelOrder(db: Db, buyerId: number, orderId: number): Promise<void> {
  await requireRole(db, buyerId, "buyer");
  const notices: Notice[] = [];
  await db.transaction(async (tx) => {
    await transition(tx, orderId, "allocated", "cancelled", eq(orders.buyerId, buyerId));
    const allocs = await tx
      .select({ a: allocations, phone: users.phone })
      .from(allocations)
      .innerJoin(lots, eq(allocations.lotId, lots.id))
      .innerJoin(users, eq(lots.farmerId, users.id))
      .where(eq(allocations.orderId, orderId));
    for (const { a, phone } of allocs) {
      await tx
        .update(lots)
        .set({ availableKg: sql`${lots.availableKg} + ${a.quantityKg}`, status: "listed" })
        .where(eq(lots.id, a.lotId));
      notices.push({ phone, body: `HarvestLink: the buyer cancelled. Your ${a.quantityKg}kg (lot #${a.lotId}) is available for sale again.` });
    }
    await tx.delete(allocations).where(eq(allocations.orderId, orderId));
    await audit(tx, { actorId: buyerId, action: "order.cancel", entity: "order", entityId: orderId });
  });
  await notify(db, notices);
}

export async function acceptJob(db: Db, transporterId: number, orderId: number): Promise<Order> {
  const t = await requireRole(db, transporterId, "transporter");
  const o = await transition(db, orderId, "allocated", "assigned", undefined, { transporterId });
  await audit(db, { actorId: transporterId, action: "order.accept", entity: "order", entityId: orderId });
  const [buyer] = await db.select().from(users).where(eq(users.id, o.buyerId));
  await notify(db, [{ phone: buyer.phone, body: `HarvestLink: order #${o.id} accepted by transporter ${t.name} (${t.phone}).` }]);
  return o;
}

export async function markPickedUp(db: Db, transporterId: number, orderId: number): Promise<Order> {
  await requireRole(db, transporterId, "transporter");
  const o = await transition(db, orderId, "assigned", "picked_up", eq(orders.transporterId, transporterId));
  await audit(db, { actorId: transporterId, action: "order.pickup", entity: "order", entityId: orderId });
  const [buyer] = await db.select().from(users).where(eq(users.id, o.buyerId));
  await notify(db, [{ phone: buyer.phone, body: `HarvestLink: order #${o.id} picked up and on its way. Confirm delivery on the website when it arrives.` }]);
  return o;
}

/**
 * The buyer confirms the produce arrived. This creates one payout per farmer
 * (sum of their allocated kg x price) plus one for the transporter, which the
 * buyer then pays directly to each wallet.
 */
export async function confirmDelivery(db: Db, buyerId: number, orderId: number): Promise<void> {
  const buyer = await requireRole(db, buyerId, "buyer");
  const notices: Notice[] = [];
  await db.transaction(async (tx) => {
    const o = await transition(tx, orderId, "picked_up", "delivered", eq(orders.buyerId, buyerId), { deliveredAt: new Date() });
    const perFarmer = await tx
      .select({
        farmerId: users.id,
        phone: users.phone,
        walletProvider: users.walletProvider,
        kg: sql<number>`sum(${allocations.quantityKg})::int`,
      })
      .from(allocations)
      .innerJoin(lots, eq(allocations.lotId, lots.id))
      .innerJoin(users, eq(lots.farmerId, users.id))
      .where(eq(allocations.orderId, orderId))
      .groupBy(users.id);

    for (const f of perFarmer) {
      if (!f.walletProvider) throw new Error(`Farmer ${f.farmerId} has no wallet provider`);
      const amount = f.kg * o.pricePerKgNgwee;
      await tx.insert(payouts).values({
        orderId,
        payeeId: f.farmerId,
        payeeType: "farmer",
        amountNgwee: amount,
        walletProvider: f.walletProvider,
        walletPhone: f.phone,
      });
      notices.push({
        phone: f.phone,
        body: `HarvestLink: order #${orderId} delivered. ${buyer.name} owes you ${formatKwacha(amount)} for ${f.kg}kg, paid to your ${walletLabels[f.walletProvider]} ${f.phone}. Dial the USSD code > Confirm payment once received.`,
      });
    }

    if (o.transporterId && o.transportFeeNgwee > 0) {
      const [t] = await tx.select().from(users).where(eq(users.id, o.transporterId));
      if (!t.walletProvider) throw new Error(`Transporter ${t.id} has no wallet provider`);
      await tx.insert(payouts).values({
        orderId,
        payeeId: t.id,
        payeeType: "transporter",
        amountNgwee: o.transportFeeNgwee,
        walletProvider: t.walletProvider,
        walletPhone: t.phone,
      });
      notices.push({ phone: t.phone, body: `HarvestLink: delivery #${orderId} confirmed. ${buyer.name} owes you ${formatKwacha(o.transportFeeNgwee)}.` });
    }
    await audit(tx, { actorId: buyerId, action: "order.deliver", entity: "order", entityId: orderId });
  });
  await notify(db, notices);
}

export async function ordersForBuyer(db: Db, buyerId: number) {
  return db
    .select({ order: orders, collectionPoint: collectionPoints.name })
    .from(orders)
    .innerJoin(collectionPoints, eq(orders.collectionPointId, collectionPoints.id))
    .where(eq(orders.buyerId, buyerId))
    .orderBy(desc(orders.createdAt));
}

/** Jobs a transporter can accept: allocated orders at collection points in their district. */
export async function openJobsFor(db: Db, transporterId: number) {
  const t = await requireRole(db, transporterId, "transporter");
  return db
    .select({ order: orders, collectionPoint: collectionPoints.name })
    .from(orders)
    .innerJoin(collectionPoints, eq(orders.collectionPointId, collectionPoints.id))
    .where(and(eq(orders.status, "allocated"), sql`lower(${collectionPoints.district}) = lower(${t.district ?? ""})`))
    .orderBy(asc(orders.createdAt))
    .limit(5);
}

export async function activeJobsFor(db: Db, transporterId: number) {
  return db
    .select({ order: orders, collectionPoint: collectionPoints.name })
    .from(orders)
    .innerJoin(collectionPoints, eq(orders.collectionPointId, collectionPoints.id))
    .where(and(eq(orders.transporterId, transporterId), inArray(orders.status, ["assigned", "picked_up"])))
    .orderBy(asc(orders.createdAt))
    .limit(5);
}
