/**
 * Outbound SMS. Every message is written to sms_outbox first, then handed to the
 * provider. A failed send never rolls back the business action that caused it;
 * it stays in the outbox as "failed" so it can be retried.
 */
import type { Db } from "@/db/client";
import { smsOutbox } from "@/db/schema";
import { eq } from "drizzle-orm";

export interface SmsProvider {
  send(phone: string, body: string): Promise<{ ref?: string }>;
}

/** Development only: prints messages instead of sending them. */
export const consoleProvider: SmsProvider = {
  async send(phone, body) {
    console.log(`[sms -> ${phone}] ${body}`);
    return {};
  },
};

/** Africa's Talking bulk SMS API (reaches MTN, Airtel and Zamtel subscribers). */
export function africasTalkingProvider(opts: {
  username: string;
  apiKey: string;
  senderId?: string;
}): SmsProvider {
  const host =
    opts.username === "sandbox" ? "https://api.sandbox.africastalking.com" : "https://api.africastalking.com";
  return {
    async send(phone, body) {
      const form = new URLSearchParams({ username: opts.username, to: phone, message: body });
      if (opts.senderId) form.set("from", opts.senderId);
      const res = await fetch(`${host}/version1/messaging`, {
        method: "POST",
        headers: { apiKey: opts.apiKey, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
      });
      if (!res.ok) throw new Error(`Africa's Talking SMS failed: HTTP ${res.status}`);
      const json = (await res.json()) as { SMSMessageData?: { Recipients?: { messageId?: string; status?: string }[] } };
      const r = json.SMSMessageData?.Recipients?.[0];
      if (r?.status && r.status !== "Success") throw new Error(`Africa's Talking SMS rejected: ${r.status}`);
      return { ref: r?.messageId };
    },
  };
}

export function providerFromEnv(env = process.env): SmsProvider {
  const kind = env.SMS_PROVIDER ?? "console";
  if (kind === "africastalking") {
    if (!env.AT_USERNAME || !env.AT_API_KEY) throw new Error("AT_USERNAME and AT_API_KEY are required");
    return africasTalkingProvider({ username: env.AT_USERNAME, apiKey: env.AT_API_KEY, senderId: env.AT_SENDER_ID });
  }
  if (env.VERCEL_ENV === "production") {
    throw new Error("The console SMS provider must not be used in production. Set SMS_PROVIDER=africastalking.");
  }
  return consoleProvider;
}

let provider: SmsProvider | undefined;
/** Override the provider (tests). */
export function setSmsProvider(p: SmsProvider) {
  provider = p;
}

export async function sendSms(db: Db, phone: string, body: string): Promise<void> {
  provider ??= providerFromEnv();
  const [row] = await db.insert(smsOutbox).values({ phone, body }).returning({ id: smsOutbox.id });
  try {
    const { ref } = await provider.send(phone, body);
    await db.update(smsOutbox).set({ status: "sent", providerRef: ref ?? null }).where(eq(smsOutbox.id, row.id));
  } catch (err) {
    console.error("SMS send failed", err);
    await db.update(smsOutbox).set({ status: "failed" }).where(eq(smsOutbox.id, row.id));
  }
}
