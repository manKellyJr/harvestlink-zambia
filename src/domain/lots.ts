import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { collectionPoints, lots, type Lot } from "@/db/schema";
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
      quantityKg,
      availableKg: quantityKg,
      minPricePerKgNgwee,
    })
    .returning();
  await audit(db, { actorId: farmerId, action: "lot.list", entity: "lot", entityId: lot.id, details: input });
  await sendSms(
    db,
    farmer.phone,
    `HarvestLink: lot #${lot.id} listed. ${quantityKg}kg ${pilot.crop} at ${cp.name}, min ${formatKwacha(minPricePerKgNgwee)}/kg. We will SMS you when a buyer reserves it.`,
  );
  return lot;
}

/** A farmer withdraws a lot. Only possible while none of it is allocated to an order. */
export async function cancelLot(db: Db, farmerId: number, lotId: number): Promise<void> {
  await requireRole(db, farmerId, "farmer");
  const updated = await db
    .update(lots)
    .set({ status: "cancelled", availableKg: 0 })
    .where(
      and(
        eq(lots.id, lotId),
        eq(lots.farmerId, farmerId),
        eq(lots.status, "listed"),
        eq(lots.availableKg, lots.quantityKg),
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

/** Kilograms available at a collection point for a buyer offering `pricePerKgNgwee`. */
export async function availableAtPrice(db: Db, collectionPointId: number, pricePerKgNgwee: number) {
  const [row] = await db
    .select({ kg: sql<number>`coalesce(sum(${lots.availableKg}), 0)::int` })
    .from(lots)
    .where(
      and(
        eq(lots.collectionPointId, collectionPointId),
        eq(lots.crop, pilot.crop),
        eq(lots.status, "listed"),
        sql`${lots.minPricePerKgNgwee} <= ${pricePerKgNgwee}`,
      ),
    );
  return row.kg;
}
