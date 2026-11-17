import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { freshDb, seedBasics, sent, listWeighed } from "./helpers";
import type { Db } from "@/db/client";
import { lots, orders, payouts, auditEvents } from "@/db/schema";
import { listLot, cancelLot, supplyByCollectionPoint } from "@/domain/lots";
import { placeOrder, acceptJob, markPickedUp, confirmDelivery, cancelOrder } from "@/domain/orders";
import { markPayoutSent, confirmPayout } from "@/domain/payouts";
import { formatKwacha, parseKwacha } from "@/domain/money";
import { normalisePhone, guessWalletProvider } from "@/domain/phone";
import { registerUser } from "@/domain/users";

describe("money and phone helpers", () => {
  it("parses and formats kwacha without floating point", () => {
    expect(parseKwacha("9.5")).toBe(950);
    expect(parseKwacha("K1,200.05")).toBe(120005);
    expect(formatKwacha(123450)).toBe("K1,234.50");
    expect(() => parseKwacha("9.555")).toThrow();
    expect(() => parseKwacha("abc")).toThrow();
  });
  it("normalises Zambian numbers", () => {
    expect(normalisePhone("0971234567")).toBe("+260971234567");
    expect(normalisePhone("+260 96 123 4567")).toBe("+260961234567");
    expect(() => normalisePhone("12345")).toThrow();
    expect(guessWalletProvider("+260961234567")).toBe("mtn");
    expect(guessWalletProvider("+260971234567")).toBe("airtel");
  });
});

describe("marketplace flow", () => {
  let db: Db;
  let s: Awaited<ReturnType<typeof seedBasics>>;
  beforeEach(async () => {
    db = await freshDb();
    s = await seedBasics(db);
  });

  const order = (qty: number, price = 1000) =>
    placeOrder(db, s.buyer.id, {
      collectionPointId: s.cp.id,
      quantityKg: qty,
      pricePerKgNgwee: price,
      transportFeeNgwee: 150000,
      deliveryAddress: "Plot 12, Lusaka South MFEZ",
    });

  it("requires consent to register", async () => {
    await expect(
      registerUser(db, { phone: "0971999999", name: "X Y", role: "farmer", district: "Mkushi", walletProvider: "mtn", consent: false as never }),
    ).rejects.toThrow(/consent/i);
  });

  it("only farmers can list lots and limits are enforced", async () => {
    await expect(listLot(db, s.buyer.id, { collectionPointId: s.cp.id, quantityKg: 100, minPricePerKgNgwee: 900 })).rejects.toThrow(/not allowed/);
    await expect(listLot(db, s.farmerA.id, { collectionPointId: s.cp.id, quantityKg: 10, minPricePerKgNgwee: 900 })).rejects.toThrow(/between/);
  });

  it("bulks small lots into one order, oldest first, respecting farmer minimum prices", async () => {
    const a = await listWeighed(db, s, s.farmerA.id, 300, 900);
    const b = await listWeighed(db, s, s.farmerB.id, 500, 950);
    const tooExpensive = await listWeighed(db, s, s.farmerB.id, 1000, 2000);

    const [supply] = await supplyByCollectionPoint(db);
    expect(supply.availableKg).toBe(1800);

    await expect(order(900)).rejects.toThrow(/Only 800 kg/);
    await order(600);

    const rows = await db.select().from(lots).orderBy(lots.id);
    expect(rows.find((l) => l.id === a.id)).toMatchObject({ availableKg: 0, status: "sold_out" });
    expect(rows.find((l) => l.id === b.id)).toMatchObject({ availableKg: 200, status: "listed" });
    expect(rows.find((l) => l.id === tooExpensive.id)).toMatchObject({ availableKg: 1000 });
    expect(sent.some((m) => m.phone === s.transporter.phone && m.body.includes("job"))).toBe(true);
  });

  it("runs the full lifecycle and pays each farmer directly", async () => {
    await listWeighed(db, s, s.farmerA.id, 300, 900);
    await listWeighed(db, s, s.farmerB.id, 500, 900);
    const o = await order(800, 1000);

    await expect(markPickedUp(db, s.transporter.id, o.id)).rejects.toThrow();
    await acceptJob(db, s.transporter.id, o.id);
    await expect(acceptJob(db, s.transporter.id, o.id)).rejects.toThrow(/not available/);
    await expect(confirmDelivery(db, s.buyer.id, o.id)).rejects.toThrow();
    await markPickedUp(db, s.transporter.id, o.id);
    await confirmDelivery(db, s.buyer.id, o.id);

    const ps = await db.select().from(payouts).where(eq(payouts.orderId, o.id)).orderBy(payouts.id);
    expect(ps.map((p) => [p.payeeId, p.amountNgwee, p.walletProvider])).toEqual([
      [s.farmerA.id, 300_000, "airtel"],
      [s.farmerB.id, 500_000, "mtn"],
      [s.transporter.id, 150_000, "zamtel"],
    ]);

    // Another farmer cannot confirm someone else's payment.
    await expect(confirmPayout(db, s.farmerB.id, ps[0].id, true)).rejects.toThrow();

    await markPayoutSent(db, s.buyer.id, ps[0].id, "MP241116.1234.A0001");
    await confirmPayout(db, s.farmerA.id, ps[0].id, true);
    await confirmPayout(db, s.farmerB.id, ps[1].id, false); // dispute
    let [current] = await db.select().from(orders).where(eq(orders.id, o.id));
    expect(current.status).toBe("delivered");
    expect(sent.some((m) => m.phone === s.buyer.phone && m.body.includes("NOT received"))).toBe(true);

    await markPayoutSent(db, s.buyer.id, ps[1].id, "MTN-998877");
    await confirmPayout(db, s.farmerB.id, ps[1].id, true);
    await confirmPayout(db, s.transporter.id, ps[2].id, true);
    [current] = await db.select().from(orders).where(eq(orders.id, o.id));
    expect(current.status).toBe("completed");

    const events = await db.select().from(auditEvents);
    expect(events.map((e) => e.action)).toContain("order.complete");
  });

  it("cancelling an order returns produce to the farmers", async () => {
    const a = await listWeighed(db, s, s.farmerA.id, 300, 900);
    const o = await order(300);
    await expect(cancelLot(db, s.farmerA.id, a.id)).rejects.toThrow();
    await cancelOrder(db, s.buyer.id, o.id);
    const [lot] = await db.select().from(lots).where(eq(lots.id, a.id));
    expect(lot).toMatchObject({ availableKg: 300, status: "listed" });
    await cancelLot(db, s.farmerA.id, a.id);
  });
});
