import type { Db } from "@/db/client";
import { auditEvents } from "@/db/schema";

export async function audit(
  db: Db,
  e: { actorId: number | null; action: string; entity: string; entityId: number; details?: unknown },
) {
  await db.insert(auditEvents).values({ ...e, details: e.details ?? null });
}
