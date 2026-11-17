/**
 * Seed pilot collection points. In development it also creates demo accounts
 * and lots so the web app has something to show. Demo data is never created
 * when NODE_ENV=production.
 */
import { getDb } from "../src/db/client";
import { collectionPoints, users } from "../src/db/schema";
import { checkInLot, listLot } from "../src/domain/lots";
import { pilot } from "../src/domain/config";

// Placeholder sites: replace with the real depots agreed with farmer groups.
const points = [
  { name: "Mkushi Farmers Depot", district: "Mkushi" },
  { name: "Chibombo Cooperative Shed", district: "Chibombo" },
  { name: "Kabwe Rural Aggregation Point", district: "Kabwe" },
];

async function main() {
  const db = await getDb();
  const existing = await db.select().from(collectionPoints);
  if (existing.length > 0) {
    console.log("Already seeded");
    return;
  }
  const cps = await db
    .insert(collectionPoints)
    .values(points.map((p) => ({ ...p, province: pilot.province })))
    .returning();
  console.log(`Created ${cps.length} collection points`);

  if (process.env.NODE_ENV === "production") return;
  const now = new Date();
  const demo = await db
    .insert(users)
    .values([
      { phone: "+260970000001", name: "Demo Farmer Mary", role: "farmer", district: "Mkushi", walletProvider: "airtel", consentAt: now },
      { phone: "+260960000002", name: "Demo Farmer John", role: "farmer", district: "Mkushi", walletProvider: "mtn", consentAt: now },
      { phone: "+260970000010", name: "Demo Buyer Feeds Ltd", role: "buyer", district: "Lusaka", walletProvider: "airtel", consentAt: now },
      { phone: "+260950000020", name: "Demo Transporter", role: "transporter", district: "Mkushi", walletProvider: "zamtel", consentAt: now },
    ])
    .returning();
  const [admin, agent] = await db
    .insert(users)
    .values([
      { phone: "+260970000099", name: "Demo Admin", role: "admin", consentAt: now },
      { phone: "+260970000050", name: "Demo Agent Mkushi", role: "agent", district: "Mkushi", collectionPointId: cps[0].id, consentAt: now },
    ])
    .returning();
  const a = await listLot(db, demo[0].id, { collectionPointId: cps[0].id, quantityKg: 400, minPricePerKgNgwee: 900 });
  const b = await listLot(db, demo[1].id, { collectionPointId: cps[0].id, quantityKg: 750, minPricePerKgNgwee: 950 });
  await listLot(db, demo[0].id, { collectionPointId: cps[0].id, quantityKg: 300, minPricePerKgNgwee: 900 });
  await checkInLot(db, agent.id, a.id, { weighedKg: 392, grade: "A" });
  await checkInLot(db, admin.id, b.id, { weighedKg: 760, grade: "B" });
  console.log("Demo logins (codes print in the dev server log): buyer 0970000010, agent 0970000050, admin 0970000099");
}
main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
