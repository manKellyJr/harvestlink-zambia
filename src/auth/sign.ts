import { createHmac, timingSafeEqual } from "node:crypto";

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET (16+ chars) must be set in production");
  return "dev-only-secret-not-for-production";
}

export function hmac(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

/** Sign a JSON payload with an expiry: base64url(payload).signature */
export function sign(payload: object, ttlSeconds: number): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlSeconds * 1000 })).toString("base64url");
  return `${body}.${hmac(body)}`;
}

export function verify<T>(token: string | undefined): T | undefined {
  if (!token) return undefined;
  const [body, sig] = token.split(".");
  if (!body || !sig) return undefined;
  const expected = Buffer.from(hmac(body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return undefined;
  const data = JSON.parse(Buffer.from(body, "base64url").toString()) as T & { exp: number };
  return data.exp > Date.now() ? data : undefined;
}
