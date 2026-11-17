import { describe, it, expect } from "vitest";
import { freshDb, sent } from "./helpers";
import { sendLoginCode, checkLoginCode } from "@/auth/otp";
import { sign, verify } from "@/auth/sign";

describe("login codes", () => {
  it("accepts the right code once and rate-limits requests", async () => {
    const db = await freshDb();
    const phone = "+260971555555";
    await sendLoginCode(db, phone);
    const code = sent.at(-1)!.body.match(/\d{6}/)![0];
    await expect(checkLoginCode(db, phone, "000000" === code ? "111111" : "000000")).rejects.toThrow(/Wrong code/);
    await checkLoginCode(db, phone, code);
    await expect(checkLoginCode(db, phone, code)).rejects.toThrow(/expired/);
    await sendLoginCode(db, phone);
    await sendLoginCode(db, phone);
    await expect(sendLoginCode(db, phone)).rejects.toThrow(/Too many/);
  });

  it("rejects tampered or expired tokens", () => {
    const t = sign({ uid: 1 }, 60);
    expect(verify<{ uid: number }>(t)?.uid).toBe(1);
    expect(verify(t.replace(/.$/, (c) => (c === "A" ? "B" : "A")))).toBeUndefined();
    expect(verify(sign({ uid: 1 }, -1))).toBeUndefined();
  });
});
