import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { users, type Role, type User } from "@/db/schema";
import { DomainError } from "./errors";
import { normalisePhone } from "./phone";
import { audit } from "./audit";

const registerInput = z.object({
  phone: z.string(),
  name: z.string().trim().min(2, "Name is too short").max(60),
  role: z.enum(["farmer", "buyer", "transporter"]),
  district: z.string().trim().min(2).max(40),
  walletProvider: z.enum(["mtn", "airtel", "zamtel"]),
  consent: z.literal(true, { error: "Consent is required to register" }),
});

/** Self-registration (USSD for farmers/transporters, web for buyers). Admins are created by seed only. */
export async function registerUser(db: Db, input: z.input<typeof registerInput>): Promise<User> {
  const parsed = registerInput.safeParse(input);
  if (!parsed.success) throw new DomainError(parsed.error.issues[0].message);
  const v = parsed.data;
  const phone = normalisePhone(v.phone);
  if (await findUserByPhone(db, phone)) throw new DomainError("This number is already registered");
  const [user] = await db
    .insert(users)
    .values({
      phone,
      name: v.name,
      role: v.role,
      district: v.district,
      walletProvider: v.walletProvider,
      consentAt: new Date(),
    })
    .returning();
  await audit(db, { actorId: user.id, action: "register", entity: "user", entityId: user.id, details: { role: v.role } });
  return user;
}

export async function findUserByPhone(db: Db, phone: string): Promise<User | undefined> {
  const [u] = await db.select().from(users).where(eq(users.phone, phone));
  return u;
}

export async function getUser(db: Db, id: number): Promise<User | undefined> {
  const [u] = await db.select().from(users).where(eq(users.id, id));
  return u;
}

/** Role-based access control: load a user and check they are active and hold one of the roles. */
export async function requireRole(db: Db, userId: number, ...roles: Role[]): Promise<User> {
  const u = await getUser(db, userId);
  if (!u || !u.active) throw new DomainError("Account not found or disabled");
  if (!roles.includes(u.role)) throw new DomainError("You are not allowed to do this");
  return u;
}
