/**
 * Create the first admin account: npm run admin:create -- 0971234567 "Your Name"
 * Later admins are created from the admin console.
 */
import { getDb } from "../src/db/client";
import { users } from "../src/db/schema";
import { normalisePhone } from "../src/domain/phone";
import { findUserByPhone } from "../src/domain/users";
import { audit } from "../src/domain/audit";

async function main() {
  const [phoneArg, ...nameParts] = process.argv.slice(2);
  const name = nameParts.join(" ").trim();
  if (!phoneArg || name.length < 2) throw new Error('Usage: npm run admin:create -- 0971234567 "Full Name"');
  const db = await getDb();
  const phone = normalisePhone(phoneArg);
  if (await findUserByPhone(db, phone)) throw new Error("That number already has an account");
  const [u] = await db.insert(users).values({ phone, name, role: "admin", consentAt: new Date() }).returning();
  await audit(db, { actorId: null, action: "user.create_admin_cli", entity: "user", entityId: u.id });
  console.log(`Admin ${name} (${phone}) created. Log in on the website with this number.`);
}
main().then(() => process.exit(0)).catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
