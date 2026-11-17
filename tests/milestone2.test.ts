import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { freshDb, seedBasics, sent, listWeighed } from "./helpers";
import type { Db } from "@/db/client";
import { collectionPoints, lots, orders, payouts, smsOutbox } from "@/db/schema";
import { checkInLot, listLot, supplyByCollectionPoint } from "@/domain/lots";
import { placeOrder, acceptJob, markPickedUp, confirmDelivery } from "@/domain/orders";
import { confirmPayout, markPayoutSent } from "@/domain/payouts";
import {
  overview,
  createCollectionPoint,
  setCollectionPointActive,
  createAccount,
  setUserActive,
  listDisputes,
  resolveDispute,
  listUsers,
} from "@/domain/admin";
import { retryFailedSms, setSmsProvider, type SmsProvider } from "@/sms";

let db: Db;
let s: Awaited<ReturnType<typeof seedBasics>>;
beforeEach(async () => {
  db = await freshDb();
  s = await seedBasics(db);
});

const order = (qty: number, extra: Partial<Parameters<typeof placeOrder>[2]> = {}) =>
  placeOrder(db, s.buyer.id, {
    collectionPointId: s.cp.id,
    quantityKg: qty,
    pricePerKgNgwee: 1000,
    transportFeeNgwee: 0,
    deliveryAddress: "Lusaka depot",
    ...extra,
  });

describe("collection point check-in", () => {
  it("only weighed lots are offered, and farmers are paid on weighed kg", async () => {
    const lot = await listLot(db, s.farmerA.id, { collectionPointId: s.cp.id, quantityKg: 500, minPricePerKgNgwee: 900 });
    expect(lot.status).toBe("awaiting_checkin");
    expect((await supplyByCollectionPoint(db))[0].availableKg).toBe(0);
    await expect(order(100)).rejects.toThrow(/Only 0 kg/);

    const weighed = await checkInLot(db, s.agent.id, lot.id, { weighedKg: 462, grade: "B" });
    expect(weighed).toMatchObject({ status: "listed", quantityKg: 462, availableKg: 462, declaredKg: 500, grade: "B" });
    expect(sent.at(-1)!.body).toMatch(/462kg, grade B/);

    const o = await order(462);
    await acceptJob(db, s.transporter.id, o.id);
    await markPickedUp(db, s.transporter.id, o.id);
    await confirmDelivery(db, s.buyer.id, o.id);
    const [p] = await db.select().from(payouts).where(eq(payouts.orderId, o.id));
    expect(p.amountNgwee).toBe(462 * 1000);
  });

  it("an agent cannot check in at another collection point, nor twice; farmers and buyers cannot at all", async () => {
    const [other] = await db.insert(collectionPoints).values({ name: "Other", district: "Kabwe", province: "Central" }).returning();
    const lot = await listLot(db, s.farmerA.id, { collectionPointId: other.id, quantityKg: 100, minPricePerKgNgwee: 900 });
    await expect(checkInLot(db, s.agent.id, lot.id, { weighedKg: 100, grade: "A" })).rejects.toThrow(/another collection point/);
    await expect(checkInLot(db, s.farmerA.id, lot.id, { weighedKg: 100, grade: "A" })).rejects.toThrow(/not allowed/);
    await expect(checkInLot(db, s.buyer.id, lot.id, { weighedKg: 100, grade: "A" })).rejects.toThrow(/not allowed/);
    await checkInLot(db, s.admin.id, lot.id, { weighedKg: 100, grade: "A" }); // admins can check in anywhere
    await expect(checkInLot(db, s.admin.id, lot.id, { weighedKg: 90, grade: "A" })).rejects.toThrow(/already/);
  });

  it("rejected lots never reach buyers", async () => {
    const lot = await listLot(db, s.farmerA.id, { collectionPointId: s.cp.id, quantityKg: 100, minPricePerKgNgwee: 900 });
    await expect(checkInLot(db, s.agent.id, lot.id, { reject: "" })).rejects.toThrow(/reason/);
    await checkInLot(db, s.agent.id, lot.id, { reject: "Too wet, mould visible" });
    const [row] = await db.select().from(lots).where(eq(lots.id, lot.id));
    expect(row).toMatchObject({ status: "rejected", availableKg: 0 });
    expect(sent.at(-1)!.body).toMatch(/not accepted.*Too wet/);
  });

  it("grade A orders only take grade A lots", async () => {
    await listWeighed(db, s, s.farmerA.id, 300, 900, "B");
    await listWeighed(db, s, s.farmerB.id, 200, 900, "A");
    await expect(order(300, { minGrade: "A" })).rejects.toThrow(/Only 200 kg of grade A/);
    await order(200, { minGrade: "A" });
    const supply = (await supplyByCollectionPoint(db))[0];
    expect(supply).toMatchObject({ availableKg: 300, gradeAKg: 0 });
  });
});

describe("admin", () => {
  it("only admins can use admin functions", async () => {
    for (const u of [s.buyer, s.agent, s.farmerA]) {
      await expect(overview(db, u.id)).rejects.toThrow(/not allowed/);
      await expect(createCollectionPoint(db, u.id, { name: "X depot", district: "Mkushi" })).rejects.toThrow(/not allowed/);
      await expect(setUserActive(db, u.id, s.farmerB.id, false)).rejects.toThrow(/not allowed/);
    }
  });

  it("manages collection points and accounts", async () => {
    const cp = await createCollectionPoint(db, s.admin.id, { name: "Chisamba Shed", district: "Chisamba" });
    expect(cp.province).toBe("Central");
    await setCollectionPointActive(db, s.admin.id, cp.id, false);
    await expect(listLot(db, s.farmerA.id, { collectionPointId: cp.id, quantityKg: 100, minPricePerKgNgwee: 900 })).rejects.toThrow(/not found/);

    await expect(createAccount(db, s.admin.id, { phone: "0971222333", name: "New Agent", role: "agent" })).rejects.toThrow(/collection point/);
    const agent = await createAccount(db, s.admin.id, { phone: "0971222333", name: "New Agent", role: "agent", collectionPointId: s.cp.id });
    expect(agent).toMatchObject({ role: "agent", district: "Mkushi", collectionPointId: s.cp.id });
    await expect(createAccount(db, s.admin.id, { phone: "0971222333", name: "Dup", role: "buyer" })).rejects.toThrow(/already registered/);

    await expect(setUserActive(db, s.admin.id, s.admin.id, false)).rejects.toThrow(/own account/);
    await setUserActive(db, s.admin.id, s.buyer.id, false);
    await expect(order(100)).rejects.toThrow(/disabled/);
    expect((await listUsers(db, s.admin.id, { role: "agent" })).length).toBe(2);
    expect((await listUsers(db, s.admin.id, { q: "0971000001" }))[0].user.id).toBe(s.farmerA.id);

    const o = await overview(db, s.admin.id);
    expect(o.users.farmer).toBe(2);
  });

  it("resolves payment disputes both ways", async () => {
    await listWeighed(db, s, s.farmerA.id, 300, 900);
    await listWeighed(db, s, s.farmerB.id, 200, 900);
    const o = await order(500);
    await acceptJob(db, s.transporter.id, o.id);
    await markPickedUp(db, s.transporter.id, o.id);
    await confirmDelivery(db, s.buyer.id, o.id);
    const [pa, pb] = await db.select().from(payouts).where(eq(payouts.orderId, o.id)).orderBy(payouts.id);

    await markPayoutSent(db, s.buyer.id, pa.id, "MP1111");
    await confirmPayout(db, s.farmerA.id, pa.id, false);
    await confirmPayout(db, s.farmerB.id, pb.id, false);
    expect((await listDisputes(db, s.admin.id)).length).toBe(2);

    await expect(resolveDispute(db, s.admin.id, pa.id, "paid", "")).rejects.toThrow(/note/);
    await resolveDispute(db, s.admin.id, pa.id, "paid", "Airtel statement shows MP1111 received");
    await resolveDispute(db, s.admin.id, pb.id, "reopen", "No transaction found with MTN");
    let [p2] = await db.select().from(payouts).where(eq(payouts.id, pb.id));
    expect(p2.status).toBe("owed");
    expect(sent.some((m) => m.phone === s.buyer.phone && /did not arrive/.test(m.body))).toBe(true);

    await markPayoutSent(db, s.buyer.id, pb.id, "MTN2222");
    await confirmPayout(db, s.farmerB.id, pb.id, true);
    [p2] = await db.select().from(payouts).where(eq(payouts.id, pb.id));
    expect(p2.status).toBe("confirmed");
    const [done] = await db.select().from(orders).where(eq(orders.id, o.id));
    expect(done.status).toBe("completed");
    expect((await overview(db, s.admin.id)).farmerPaymentsConfirmedNgwee).toBe(500_000);
  });
});

describe("SMS retry", () => {
  it("retries failed messages up to the limit", async () => {
    let up = false;
    const flaky: SmsProvider = {
      async send() {
        if (!up) throw new Error("network down");
        return { ref: "ok" };
      },
    };
    setSmsProvider(flaky);
    await listLot(db, s.farmerA.id, { collectionPointId: s.cp.id, quantityKg: 100, minPricePerKgNgwee: 900 });
    let [m] = await db.select().from(smsOutbox);
    expect(m).toMatchObject({ status: "failed", attempts: 1 });

    expect(await retryFailedSms(db)).toEqual({ retried: 1, sent: 0 });
    up = true;
    expect(await retryFailedSms(db)).toEqual({ retried: 1, sent: 1 });
    [m] = await db.select().from(smsOutbox);
    expect(m).toMatchObject({ status: "sent", attempts: 3 });
    expect(await retryFailedSms(db)).toEqual({ retried: 0, sent: 0 });

    up = false;
    await listLot(db, s.farmerA.id, { collectionPointId: s.cp.id, quantityKg: 100, minPricePerKgNgwee: 900 });
    for (let i = 0; i < 5; i++) await retryFailedSms(db);
    const failed = await db.select().from(smsOutbox).where(eq(smsOutbox.status, "failed"));
    expect(failed[0].attempts).toBe(4);
  });
});

describe("first admin bootstrap", () => {
  it("creates an admin only for the configured number and only if none exists", async () => {
    const fresh = await freshDb();
    const { bootstrapAdmin } = await import("@/domain/users");
    const env = { BOOTSTRAP_ADMIN_PHONE: "0971888999" };
    expect(await bootstrapAdmin(fresh, "+260971000000", env)).toBeUndefined();
    expect(await bootstrapAdmin(fresh, "+260971888999", {})).toBeUndefined();
    const a = await bootstrapAdmin(fresh, "+260971888999", env);
    expect(a?.role).toBe("admin");
    expect(await bootstrapAdmin(db, "+260971888999", env)).toBeUndefined(); // db already has an admin
  });
});
