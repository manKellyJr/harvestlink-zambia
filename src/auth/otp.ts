/** One-time SMS login codes for the web app (no passwords to forget or leak). */
import { randomInt } from "node:crypto";
import { and, desc, eq, gte, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { loginCodes } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import { sendSms } from "@/sms";
import { hmac } from "./sign";

const TTL_MS = 10 * 60 * 1000;
const MAX_CODES_PER_WINDOW = 3;
const MAX_ATTEMPTS = 5;

export async function sendLoginCode(db: Db, phone: string): Promise<void> {
  const recent = await db
    .select({ id: loginCodes.id })
    .from(loginCodes)
    .where(and(eq(loginCodes.phone, phone), gte(loginCodes.createdAt, new Date(Date.now() - 15 * 60 * 1000))));
  if (recent.length >= MAX_CODES_PER_WINDOW) throw new DomainError("Too many codes requested. Try again in 15 minutes.");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.insert(loginCodes).values({ phone, codeHash: hmac(`${phone}:${code}`), expiresAt: new Date(Date.now() + TTL_MS) });
  await sendSms(db, phone, `Your HarvestLink login code is ${code}. It expires in 10 minutes. Never share it.`);
}

export async function checkLoginCode(db: Db, phone: string, code: string): Promise<void> {
  const [row] = await db
    .select()
    .from(loginCodes)
    .where(and(eq(loginCodes.phone, phone), isNull(loginCodes.usedAt), gte(loginCodes.expiresAt, new Date())))
    .orderBy(desc(loginCodes.createdAt))
    .limit(1);
  if (!row || row.attempts >= MAX_ATTEMPTS) throw new DomainError("Code expired. Request a new one.");
  if (row.codeHash !== hmac(`${phone}:${code.trim()}`)) {
    await db.update(loginCodes).set({ attempts: row.attempts + 1 }).where(eq(loginCodes.id, row.id));
    throw new DomainError("Wrong code");
  }
  await db.update(loginCodes).set({ usedAt: new Date() }).where(eq(loginCodes.id, row.id));
}
