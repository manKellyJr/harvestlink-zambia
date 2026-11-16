/**
 * Payment records. In v1 the buyer pays each farmer and the transporter directly
 * from their own mobile money wallet; HarvestLink never touches the funds (no
 * Bank of Zambia e-money licence needed). We record what is owed, the buyer's
 * transaction reference, and the payee's confirmation, so every kwacha is traceable.
 */
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import type { Db } from "@/db/client";
import { orders, payouts, users } from "@/db/schema";
import { DomainError } from "./errors";
import { requireRole } from "./users";
import { audit } from "./audit";
import { formatKwacha } from "./money";
import { sendSms } from "@/sms";

export async function payoutsForOrder(db: Db, buyerId: number, orderId: number) {
  return db
    .select({ payout: payouts, payeeName: users.name })
    .from(payouts)
    .innerJoin(orders, eq(payouts.orderId, orders.id))
    .innerJoin(users, eq(payouts.payeeId, users.id))
    .where(and(eq(payouts.orderId, orderId), eq(orders.buyerId, buyerId)))
    .orderBy(payouts.id);
}

/** The buyer records that they sent a payment, with the mobile money transaction ID. */
export async function markPayoutSent(db: Db, buyerId: number, payoutId: number, reference: string) {
  await requireRole(db, buyerId, "buyer");
  const ref = reference.trim();
  if (!/^[A-Za-z0-9.\-]{4,40}$/.test(ref)) throw new DomainError("Enter the mobile money transaction ID");
  const [row] = await db
    .select({ payout: payouts, order: orders })
    .from(payouts)
    .innerJoin(orders, eq(payouts.orderId, orders.id))
    .where(eq(payouts.id, payoutId));
  if (!row || row.order.buyerId !== buyerId) throw new DomainError("Payment not found");
  const [p] = await db
    .update(payouts)
    .set({ status: "buyer_marked_paid", buyerReference: ref, updatedAt: new Date() })
    .where(and(eq(payouts.id, payoutId), inArray(payouts.status, ["owed", "disputed"])))
    .returning();
  if (!p) throw new DomainError("This payment is already confirmed");
  await audit(db, { actorId: buyerId, action: "payout.mark_sent", entity: "payout", entityId: payoutId, details: { ref } });
  await sendSms(
    db,
    p.walletPhone,
    `HarvestLink: the buyer says they sent you ${formatKwacha(p.amountNgwee)} (ref ${ref}). Dial the USSD code > Confirm payment to confirm or report a problem.`,
  );
}

export async function pendingPayoutsFor(db: Db, payeeId: number) {
  return db
    .select()
    .from(payouts)
    .where(and(eq(payouts.payeeId, payeeId), inArray(payouts.status, ["owed", "buyer_marked_paid"])))
    .orderBy(desc(payouts.createdAt))
    .limit(5);
}

/**
 * The farmer or transporter confirms (or disputes) receipt. When every payout of
 * an order is confirmed, the order is completed.
 */
export async function confirmPayout(db: Db, payeeId: number, payoutId: number, received: boolean) {
  await requireRole(db, payeeId, "farmer", "transporter");
  const [p] = await db
    .update(payouts)
    .set({ status: received ? "confirmed" : "disputed", updatedAt: new Date() })
    .where(
      and(eq(payouts.id, payoutId), eq(payouts.payeeId, payeeId), inArray(payouts.status, ["owed", "buyer_marked_paid"])),
    )
    .returning();
  if (!p) throw new DomainError("Payment not found");
  await audit(db, {
    actorId: payeeId,
    action: received ? "payout.confirm" : "payout.dispute",
    entity: "payout",
    entityId: payoutId,
  });

  const [order] = await db.select().from(orders).where(eq(orders.id, p.orderId));
  const [buyer] = await db.select().from(users).where(eq(users.id, order.buyerId));
  if (!received) {
    await sendSms(
      db,
      buyer.phone,
      `HarvestLink: a payee reports they have NOT received ${formatKwacha(p.amountNgwee)} for order #${order.id}. Please check and pay ${p.walletPhone}.`,
    );
    return;
  }
  const unconfirmed = await db
    .select({ id: payouts.id })
    .from(payouts)
    .where(and(eq(payouts.orderId, order.id), ne(payouts.status, "confirmed")));
  if (unconfirmed.length === 0) {
    await db.update(orders).set({ status: "completed" }).where(and(eq(orders.id, order.id), eq(orders.status, "delivered")));
    await audit(db, { actorId: null, action: "order.complete", entity: "order", entityId: order.id });
  }
}
