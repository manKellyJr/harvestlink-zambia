import { and, asc, desc, eq, gt, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { collectionPoints, lots, users, type Grade, type Lot } from "@/db/schema";
import { DomainError } from "./errors";
import { limits, pilot } from "./config";
import { requireRole } from "./users";
import { audit } from "./audit";
import { formatKwacha } from "./money";
import { sendSms } from "@/sms";

export async function listActiveCollectionPoints(db: Db, district?: string) {
  const where = district
    ? and(eq(collectionPoints.active, true), sql`lower(${collectionPoints.district}) = lower(${district})`)
    : eq(collectionPoints.active, true);
  return db.select().from(collectionPoints).where(where).orderBy(asc(collectionPoints.name));
}

/** A farmer offers produce for sale at a collection point. */
export async function listLot(
  db: Db,
  farmerId: number,
  input: { collectionPointId: number; quantityKg: number; minPricePerKgNgwee: number },
): Promise<Lot> {
  const farmer = await requireRole(db, farmerId, "farmer");
  const { collectionPointId, quantityKg, minPricePerKgNgwee } = input;
  if (!Number.isInteger(quantityKg) || quantityKg < limits.minLotKg || quantityKg > limits.maxLotKg) {
    throw new DomainError(`Quantity must be between ${limits.minLotKg} and ${limits.maxLotKg} kg`);
  }
  if (!Number.isInteger(minPricePerKgNgwee) || minPricePerKgNgwee <= 0 || minPricePerKgNgwee > limits.maxPricePerKgNgwee) {
    throw new DomainError("Enter a valid price per kg");
  }
  const [cp] = await db.select().from(collectionPoints).where(eq(collectionPoints.id, collectionPointId));
  if (!cp || !cp.active) throw new DomainError("Collection point not found");

  const [lot] = await db
    .insert(lots)
    .values({
      farmerId,
      collectionPointId,
      crop: pilot.crop,
      declaredKg: quantityKg,
      minPricePerKgNgwee,
    })
    .returning();
  await audit(db, { actorId: farmerId, action: "lot.list", entity: "lot", entityId: lot.id, details: input });
  await sendSms(
    db,
    farmer.phone,
    `HarvestLink: lot #${lot.id} registered (${quantityKg}kg ${pilot.crop}, min ${formatKwacha(minPricePerKgNgwee)}/kg). Bring it to ${cp.name} to be weighed and graded. Buyers can only reserve weighed lots.`,
  );
  return lot;
}

/** A farmer withdraws a lot. Only possible before check-in, or while none of it is allocated. */
export async function cancelLot(db: Db, farmerId: number, lotId: number): Promise<void> {
  await requireRole(db, farmerId, "farmer");
  const updated = await db
    .update(lots)
    .set({ status: "cancelled", availableKg: 0 })
    .where(
      and(
        eq(lots.id, lotId),
        eq(lots.farmerId, farmerId),
        or(
          eq(lots.status, "awaiting_checkin"),
          and(eq(lots.status, "listed"), eq(lots.availableKg, lots.quantityKg)),
        ),
      ),
    )
    .returning({ id: lots.id });
  if (updated.length === 0) throw new DomainError("This lot cannot be cancelled (not yours, or already reserved)");
  await audit(db, { actorId: farmerId, action: "lot.cancel", entity: "lot", entityId: lotId });
}

export async function lotsForFarmer(db: Db, farmerId: number) {
  return db
    .select({ lot: lots, collectionPoint: collectionPoints.name })
    .from(lots)
    .innerJoin(collectionPoints, eq(lots.collectionPointId, collectionPoints.id))
    .where(eq(lots.farmerId, farmerId))
    .orderBy(desc(lots.createdAt));
}

/**
 * Bulked supply per collection point: what a buyer can order right now.
 * Shows total available kg and the lowest farmer minimum price, without exposing
 * individual farmers' details.
 */
export async function supplyByCollectionPoint(db: Db) {
  return db
    .select({
      collectionPointId: collectionPoints.id,
      name: collectionPoints.name,
      district: collectionPoints.district,
      availableKg: sql<number>`coalesce(sum(${lots.availableKg}), 0)::int`,
      gradeAKg: sql<number>`coalesce(sum(${lots.availableKg}) filter (where ${lots.grade} = 'A'), 0)::int`,
      lots: sql<number>`count(${lots.id})::int`,
      lowestMinPriceNgwee: sql<number | null>`min(${lots.minPricePerKgNgwee})`,
    })
    .from(collectionPoints)
    .leftJoin(
      lots,
      and(
        eq(lots.collectionPointId, collectionPoints.id),
        eq(lots.status, "listed"),
        eq(lots.crop, pilot.crop),
        gt(lots.availableKg, 0),
      ),
    )
    .where(eq(collectionPoints.active, true))
    .groupBy(collectionPoints.id)
    .orderBy(asc(collectionPoints.name));
}

/**
 * Collection-point check-in. An agent weighs and grades the produce in front of
 * the farmer. The weighed kg replaces the declared kg and is the only figure
 * used for allocation and payment. Agents may only check in at their own point.
 */
export async function checkInLot(
  db: Db,
  agentId: number,
  lotId: number,
  result: { weighedKg: number; grade: Grade } | { reject: string },
): Promise<Lot> {
  const agent = await requireRole(db, agentId, "agent", "admin");
  const [row] = await db
    .select({ lot: lots, cpName: collectionPoints.name, farmerPhone: users.phone })
    .from(lots)
    .innerJoin(collectionPoints, eq(lots.collectionPointId, collectionPoints.id))
    .innerJoin(users, eq(lots.farmerId, users.id))
    .where(eq(lots.id, lotId));
  if (!row) throw new DomainError("Lot not found");
  if (agent.role === "agent" && agent.collectionPointId !== row.lot.collectionPointId) {
    throw new DomainError("This lot belongs to another collection point");
  }

  let set: Partial<typeof lots.$inferInsert>;
  let sms: string;
  if ("reject" in result) {
    const reason = result.reject.trim();
    if (reason.length < 3) throw new DomainError("Give a reason for rejecting the lot");
    set = { status: "rejected", availableKg: 0 };
    sms = `HarvestLink: lot #${lotId} was not accepted at ${row.cpName}: ${reason}. You can list again after fixing this.`;
  } else {
    const { weighedKg, grade } = result;
    if (!Number.isInteger(weighedKg) || weighedKg < 1 || weighedKg > limits.maxLotKg) {
      throw new DomainError("Enter the weighed kg as a whole number");
    }
    if (grade !== "A" && grade !== "B") throw new DomainError("Choose grade A or B");
    set = { status: "listed", quantityKg: weighedKg, availableKg: weighedKg, grade };
    sms = `HarvestLink: lot #${lotId} weighed at ${row.cpName}: ${weighedKg}kg, grade ${grade}. It is now offered to buyers. Keep it at the collection point.`;
  }
  const [updated] = await db
    .update(lots)
    .set({ ...set, checkedInAt: new Date(), checkedInBy: agentId })
    .where(and(eq(lots.id, lotId), eq(lots.status, "awaiting_checkin")))
    .returning();
  if (!updated) throw new DomainError("This lot has already been checked in or cancelled");
  await audit(db, {
    actorId: agentId,
    action: "reject" in result ? "lot.reject" : "lot.checkin",
    entity: "lot",
    entityId: lotId,
    details: { ...result, declaredKg: row.lot.declaredKg },
  });
  await sendSms(db, row.farmerPhone, sms);
  return updated;
}

/** Lots waiting to be weighed at a collection point, oldest first. */
export async function lotsAwaitingCheckin(db: Db, collectionPointId: number) {
  return db
    .select({ lot: lots, farmerName: users.name, farmerPhone: users.phone })
    .from(lots)
    .innerJoin(users, eq(lots.farmerId, users.id))
    .where(and(eq(lots.collectionPointId, collectionPointId), eq(lots.status, "awaiting_checkin")))
    .orderBy(asc(lots.createdAt));
}
