/**
 * USSD callback for Africa's Talking. Configure the callback URL as
 * https://<host>/api/ussd?key=<USSD_WEBHOOK_KEY>. The gateway does not sign
 * requests, so the shared key (required in production) stops anyone else from
 * driving farmer accounts through this endpoint.
 */
import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/db/client";
import { handleUssd } from "@/ussd/engine";

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
  const reply = await handleUssd(await getDb(), { phoneNumber, text });
  return new Response(reply, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
