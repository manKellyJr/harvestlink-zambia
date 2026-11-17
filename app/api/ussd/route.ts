/**
 * USSD callback for Africa's Talking. Configure the callback URL as
 * https://<host>/api/ussd?key=<USSD_WEBHOOK_KEY>. The gateway does not sign
 * requests, so the shared key (required in production) stops anyone else from
 * driving farmer accounts through this endpoint.
 */
import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/db/client";
import { after } from "next/server";
import { handleUssd } from "@/ussd/engine";
import { retryFailedSms } from "@/sms";

function keyOk(given: string | null): boolean {
  const expected = process.env.USSD_WEBHOOK_KEY;
  if (!expected) return process.env.NODE_ENV !== "production";
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!keyOk(new URL(req.url).searchParams.get("key"))) return new Response("Forbidden", { status: 403 });
  const form = await req.formData();
  const phoneNumber = String(form.get("phoneNumber") ?? "");
  const text = String(form.get("text") ?? "");
  const db = await getDb();
  const reply = await handleUssd(db, { phoneNumber, text });
  // Retry a few failed SMS after the response is sent, so the farmer never waits on it.
  after(() => retryFailedSms(db, 5).catch((e) => console.error("SMS retry failed", e)));
  return new Response(reply, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
