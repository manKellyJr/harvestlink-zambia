import { and, desc, eq, gte, ne, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { collectionPoints, orders } from "@/db/schema";
import { pilot } from "./config";

/** Latest buyer price per collection point in a district over the last 30 days (price transparency for farmers). */
export async function recentPrices(db: Db, district: string) {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  return db
    .selectDistinctOn([collectionPoints.id], {
      collectionPoint: collectionPoints.name,
      pricePerKgNgwee: orders.pricePerKgNgwee,
    })
    .from(orders)
    .innerJoin(collectionPoints, eq(orders.collectionPointId, collectionPoints.id))
    .where(
      and(
        eq(orders.crop, pilot.crop),
        ne(orders.status, "cancelled"),
        gte(orders.createdAt, since),
        sql`lower(${collectionPoints.district}) = lower(${district})`,
      ),
    )
    .orderBy(collectionPoints.id, desc(orders.createdAt))
    .limit(4);
}
