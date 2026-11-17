import { createPgliteDb, type Db } from "@/db/client";
import { collectionPoints, users } from "@/db/schema";
import { setSmsProvider } from "@/sms";
import { checkInLot, listLot } from "@/domain/lots";

export const sent: { phone: string; body: string }[] = [];
setSmsProvider({
  async send(phone, body) {
    sent.push({ phone, body });
    return { ref: "test" };
  },
});

export async function freshDb(): Promise<Db> {
  sent.length = 0;
  resetSms();
  return createPgliteDb(); // in-memory Postgres with real migrations
}

export async function seedBasics(db: Db) {
  const [cp] = await db
    .insert(collectionPoints)
    .values({ name: "Mkushi Depot", district: "Mkushi", province: "Central" })
    .returning();
  const mk = (phone: string, name: string, role: "farmer" | "buyer" | "transporter", walletProvider: "mtn" | "airtel" | "zamtel" = "airtel") =>
    db.insert(users).values({ phone, name, role, district: "Mkushi", walletProvider, consentAt: new Date() }).returning().then((r) => r[0]);
  return {
    cp,
    farmerA: await mk("+260971000001", "Mary Phiri", "farmer"),
    farmerB: await mk("+260961000002", "John Banda", "farmer", "mtn"),
    buyer: await mk("+260971000010", "Lusaka Feeds Ltd", "buyer"),
    transporter: await mk("+260951000020", "Chanda Haulage", "transporter", "zamtel"),
    agent: await db
      .insert(users)
      .values({ phone: "+260971000030", name: "Agent Mkushi", role: "agent", district: "Mkushi", collectionPointId: cp.id, consentAt: new Date() })
      .returning()
      .then((r) => r[0]),
    admin: await db
      .insert(users)
      .values({ phone: "+260971000040", name: "Admin", role: "admin", consentAt: new Date() })
      .returning()
      .then((r) => r[0]),
  };
}

/** List a lot and check it in at the declared weight, as an agent would. */
export async function listWeighed(
  db: Db,
  s: Awaited<ReturnType<typeof seedBasics>>,
  farmerId: number,
  kg: number,
  minPricePerKgNgwee: number,
  grade: "A" | "B" = "A",
) {
  const lot = await listLot(db, farmerId, { collectionPointId: s.cp.id, quantityKg: kg, minPricePerKgNgwee });
  return checkInLot(db, s.agent.id, lot.id, { weighedKg: kg, grade });
}

/** Restore the capturing SMS provider (a test may swap it). */
export function resetSms() {
  setSmsProvider({
    async send(phone, body) {
      sent.push({ phone, body });
      return { ref: "test" };
    },
  });
}
