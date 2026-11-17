"use server";

import { getDb } from "@/db/client";
import { requireSessionRole } from "@/auth/session";
import { checkInLot } from "@/domain/lots";
import { createAccount, createCollectionPoint, resolveDispute, setCollectionPointActive, setUserActive } from "@/domain/admin";
import { runAction, field } from "@/web/action";
import type { Role } from "@/db/schema";

export async function checkInAction(form: FormData) {
  const back = field(form, "back") || "/agent";
  return runAction(back, async () => {
    const staff = await requireSessionRole("agent", "admin");
    const lotId = Number(field(form, "lotId"));
    await checkInLot(await getDb(), staff.id, lotId, {
      weighedKg: Number(field(form, "weighedKg")),
      grade: field(form, "grade") === "A" ? "A" : "B",
    });
    return `${back}${back.includes("?") ? "&" : "?"}notice=${encodeURIComponent(`Lot #${lotId} checked in`)}`;
  });
}

export async function rejectLotAction(form: FormData) {
  const back = field(form, "back") || "/agent";
  return runAction(back, async () => {
    const staff = await requireSessionRole("agent", "admin");
    await checkInLot(await getDb(), staff.id, Number(field(form, "lotId")), { reject: field(form, "reason") });
  });
}

export async function createCollectionPointAction(form: FormData) {
  return runAction("/admin/collection-points", async () => {
    const admin = await requireSessionRole("admin");
    await createCollectionPoint(await getDb(), admin.id, {
      name: field(form, "name"),
      district: field(form, "district"),
      description: field(form, "description"),
    });
  });
}

export async function toggleCollectionPointAction(form: FormData) {
  return runAction("/admin/collection-points", async () => {
    const admin = await requireSessionRole("admin");
    await setCollectionPointActive(await getDb(), admin.id, Number(field(form, "id")), field(form, "active") === "true");
  });
}

export async function createAccountAction(form: FormData) {
  return runAction("/admin/users", async () => {
    const admin = await requireSessionRole("admin");
    const cp = Number(field(form, "collectionPointId"));
    const wallet = field(form, "walletProvider");
    await createAccount(await getDb(), admin.id, {
      phone: field(form, "phone"),
      name: field(form, "name"),
      role: field(form, "role") as "agent" | "admin" | "buyer",
      district: field(form, "district") || undefined,
      collectionPointId: cp > 0 ? cp : undefined,
      walletProvider: wallet ? (wallet as "mtn" | "airtel" | "zamtel") : undefined,
    });
  });
}

export async function toggleUserAction(form: FormData) {
  const role = field(form, "filterRole");
  return runAction(`/admin/users${role ? `?role=${role as Role}` : ""}`, async () => {
    const admin = await requireSessionRole("admin");
    await setUserActive(await getDb(), admin.id, Number(field(form, "id")), field(form, "active") === "true");
  });
}

export async function resolveDisputeAction(form: FormData) {
  return runAction("/admin/disputes", async () => {
    const admin = await requireSessionRole("admin");
    await resolveDispute(
      await getDb(),
      admin.id,
      Number(field(form, "payoutId")),
      field(form, "outcome") === "paid" ? "paid" : "reopen",
      field(form, "note"),
    );
  });
}
