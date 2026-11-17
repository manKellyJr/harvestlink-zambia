import type { Role } from "@/db/schema";

/** Where each role lands after logging in on the web. */
export function homeFor(role: Role): string {
  if (role === "admin") return "/admin";
  if (role === "agent") return "/agent";
  return "/buyer";
}
