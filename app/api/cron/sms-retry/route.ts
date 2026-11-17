/** Scheduled SMS retry (Vercel Cron sends `Authorization: Bearer $CRON_SECRET`). */
import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/db/client";
import { retryFailedSms } from "@/sms";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const ok = !!secret && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) return new Response("Forbidden", { status: 403 });
  return Response.json(await retryFailedSms(await getDb()));
}
