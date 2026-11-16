import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getUser } from "@/domain/users";
import type { Role, User } from "@/db/schema";
import { sign, verify } from "./sign";

const COOKIE = "hl_session";
const TTL = 7 * 24 * 3600;

export async function startSession(userId: number) {
  (await cookies()).set(COOKIE, sign({ uid: userId }, TTL), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: TTL,
    path: "/",
  });
}

export async function endSession() {
  (await cookies()).delete(COOKIE);
}

export async function currentUser(): Promise<User | undefined> {
  const data = verify<{ uid: number }>((await cookies()).get(COOKIE)?.value);
  if (!data) return undefined;
  const user = await getUser(await getDb(), data.uid);
  return user?.active ? user : undefined;
}

/** Use in pages and server actions: redirects to login unless the user has one of the roles. */
export async function requireSessionRole(...roles: Role[]): Promise<User> {
  const user = await currentUser();
  if (!user || !roles.includes(user.role)) redirect("/login");
  return user;
}
