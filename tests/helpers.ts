import { createPgliteDb, type Db } from "@/db/client";
import { collectionPoints, users } from "@/db/schema";
import { setSmsProvider } from "@/sms";

export const sent: { phone: string; body: string }[] = [];
setSmsProvider({
  async send(phone, body) {
    sent.push({ phone, body });
    return { ref: "test" };
  },
});

export async function freshDb(): Promise<Db> {
  sent.length = 0;
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
  };
}
