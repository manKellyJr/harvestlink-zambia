import { describe, it, expect, beforeEach } from "vitest";
import { freshDb, seedBasics } from "./helpers";
import type { Db } from "@/db/client";
import { handleUssd } from "@/ussd/engine";
import { findUserByPhone } from "@/domain/users";
import { placeOrder, confirmDelivery } from "@/domain/orders";
import { checkInLot } from "@/domain/lots";
import { setUserActive } from "@/domain/admin";

describe("USSD", () => {
  let db: Db;
  let s: Awaited<ReturnType<typeof seedBasics>>;
  beforeEach(async () => {
    db = await freshDb();
    s = await seedBasics(db);
  });
  const dial = (phone: string, text: string) => handleUssd(db, { phoneNumber: phone, text });

  it("registers a new farmer with consent", async () => {
    const phone = "+260977123456";
    expect(await dial(phone, "")).toMatch(/^CON Welcome/);
    expect(await dial(phone, "1*Grace Mwale*Mkushi*2")).toMatch(/I agree/);
    expect(await dial(phone, "1*Grace Mwale*Mkushi*2*2")).toBe("END Registration cancelled.");
    expect(await findUserByPhone(db, phone)).toBeUndefined();
    expect(await dial(phone, "1*Grace Mwale*Mkushi*2*1")).toMatch(/^END Welcome Grace Mwale/);
    const u = await findUserByPhone(db, phone);
    expect(u).toMatchObject({ role: "farmer", walletProvider: "airtel", district: "Mkushi" });
    expect(u?.consentAt).toBeInstanceOf(Date);
  });

  it("lets a farmer list a lot and rejects bad input", async () => {
    const p = s.farmerA.phone;
    expect(await dial(p, "1")).toMatch(/Mkushi Depot/);
    expect(await dial(p, "1*1*500*9.50")).toMatch(/Sell 500kg soybeans at Mkushi Depot for at least K9.50\/kg/);
    expect(await dial(p, "1*1*500*9.50*1")).toMatch(/^END Lot #1 registered. Bring it to Mkushi Depot to be weighed/);
    expect(await dial(p, "1*1*10*9*1")).toMatch(/^END Quantity must be between/);
    expect(await dial(p, "1*1*500*abc")).toMatch(/^END Enter an amount/);
    expect(await dial(p, "1*9")).toMatch(/^END Invalid choice/);
    expect(await dial(p, "2")).toMatch(/#1 500kg to be weighed/);
    await checkInLot(db, s.agent.id, 1, { weighedKg: 480, grade: "A" });
    expect(await dial(p, "2")).toMatch(/#1 480kg 480kg unsold/);
  });

  it("transporter accepts and picks up, farmer confirms payment", async () => {
    await dial(s.farmerA.phone, "1*1*300*9*1");
    await checkInLot(db, s.agent.id, 1, { weighedKg: 300, grade: "B" });
    const o = await placeOrder(db, s.buyer.id, {
      collectionPointId: s.cp.id, quantityKg: 300, pricePerKgNgwee: 1000, transportFeeNgwee: 0, deliveryAddress: "Mkushi boma",
    });
    expect(await dial(s.transporter.phone, "1")).toMatch(new RegExp(`#${o.id} 300kg Mkushi Depot`));
    expect(await dial(s.transporter.phone, "1*1*1")).toMatch(/is yours/);
    expect(await dial(s.transporter.phone, "2*1*1")).toMatch(/picked up/);
    await confirmDelivery(db, s.buyer.id, o.id);

    expect(await dial(s.farmerA.phone, "3")).toMatch(/K3,000.00 order #/);
    expect(await dial(s.farmerA.phone, "3*1*1")).toBe("END Thank you. Payment confirmed.");
    expect(await dial(s.farmerA.phone, "3")).toBe("END No payments waiting for confirmation.");
    expect(await dial(s.farmerA.phone, "4")).toMatch(/Mkushi Depot: K10.00\/kg/);
  });

  it("sends buyers and staff to the website, and blocks suspended accounts", async () => {
    expect(await dial(s.buyer.phone, "")).toMatch(/website/);
    expect(await dial(s.agent.phone, "")).toMatch(/website/);
    await setUserActive(db, s.admin.id, s.farmerA.id, false);
    expect(await dial(s.farmerA.phone, "")).toMatch(/suspended/);
  });
});
