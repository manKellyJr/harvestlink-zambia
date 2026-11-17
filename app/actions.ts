"use server";

import { cookies } from "next/headers";
import { getDb } from "@/db/client";
import { DomainError } from "@/domain/errors";
import { normalisePhone } from "@/domain/phone";
import { parseKwacha } from "@/domain/money";
import { bootstrapAdmin, findUserByPhone, registerUser } from "@/domain/users";
import { placeOrder, cancelOrder, confirmDelivery } from "@/domain/orders";
import { markPayoutSent } from "@/domain/payouts";
import { sendLoginCode, checkLoginCode } from "@/auth/otp";
import { endSession, requireSessionRole, startSession } from "@/auth/session";
import { sign, verify } from "@/auth/sign";
import { homeFor } from "@/auth/home";
import { runAction, field } from "@/web/action";

const PENDING = "hl_pending_signup";
type PendingSignup = { phone: string; name: string; district: string; walletProvider: "mtn" | "airtel" | "zamtel" };

export async function requestLogin(form: FormData) {
  return runAction("/login", async () => {
    const db = await getDb();
    const phone = normalisePhone(field(form, "phone"));
    const user = (await findUserByPhone(db, phone)) ?? (await bootstrapAdmin(db, phone));
    if (!user) throw new DomainError("This number is not registered. Sign up first.");
    if (user.role === "farmer" || user.role === "transporter") {
      throw new DomainError("Farmers and transporters use the USSD menu on their phone.");
    }
    await sendLoginCode(db, phone);
    return `/login/verify?phone=${encodeURIComponent(phone)}`;
  });
}

export async function requestSignup(form: FormData) {
  return runAction("/signup", async () => {
    const db = await getDb();
    const phone = normalisePhone(field(form, "phone"));
    if (form.get("consent") !== "on") throw new DomainError("Please accept the privacy notice to continue.");
    if (await findUserByPhone(db, phone)) throw new DomainError("This number is already registered. Log in instead.");
    const wallet = field(form, "walletProvider");
    if (!["mtn", "airtel", "zamtel"].includes(wallet)) throw new DomainError("Choose a mobile money provider");
    const pending: PendingSignup = {
      phone,
      name: field(form, "name").trim(),
      district: field(form, "district").trim(),
      walletProvider: wallet as PendingSignup["walletProvider"],
    };
    if (pending.name.length < 2 || pending.district.length < 2) throw new DomainError("Enter your business name and district");
    await sendLoginCode(db, phone);
    (await cookies()).set(PENDING, sign(pending, 15 * 60), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 900 });
    return `/login/verify?phone=${encodeURIComponent(phone)}`;
  });
}

export async function verifyLogin(form: FormData) {
  const phoneRaw = field(form, "phone");
  return runAction(`/login/verify?phone=${encodeURIComponent(phoneRaw)}`, async () => {
    const db = await getDb();
    const phone = normalisePhone(phoneRaw);
    await checkLoginCode(db, phone, field(form, "code"));
    const jar = await cookies();
    let user = await findUserByPhone(db, phone);
    const pending = verify<PendingSignup>(jar.get(PENDING)?.value);
    if (!user && pending?.phone === phone) {
      user = await registerUser(db, { ...pending, role: "buyer", consent: true });
    }
    jar.delete(PENDING);
    if (!user) throw new DomainError("This number is not registered.");
    if (!user.active) throw new DomainError("This account is suspended.");
    await startSession(user.id);
    return homeFor(user.role);
  });
}

export async function logout() {
  await endSession();
  return runAction("/", async () => {});
}

export async function createOrder(form: FormData) {
  // On error, send the entered values back so the buyer does not retype them.
  const keep = new URLSearchParams({
    cp: field(form, "collectionPointId"),
    kg: field(form, "quantityKg"),
    price: field(form, "pricePerKg"),
    fee: field(form, "transportFee"),
    addr: field(form, "deliveryAddress"),
    grade: field(form, "minGrade"),
  });
  return runAction(`/buyer?${keep}`, async () => {
    const buyer = await requireSessionRole("buyer");
    const quantityKg = Number(field(form, "quantityKg"));
    await placeOrder(await getDb(), buyer.id, {
      collectionPointId: Number(field(form, "collectionPointId")),
      quantityKg,
      pricePerKgNgwee: parseKwacha(field(form, "pricePerKg")),
      transportFeeNgwee: parseKwacha(field(form, "transportFee") || "0"),
      deliveryAddress: field(form, "deliveryAddress"),
      minGrade: field(form, "minGrade") === "A" ? "A" : "B",
    });
    return "/buyer?notice=Order%20placed.%20Farmers%20and%20transporters%20have%20been%20notified.";
  });
}

export async function cancelOrderAction(form: FormData) {
  return runAction("/buyer", async () => {
    const buyer = await requireSessionRole("buyer");
    await cancelOrder(await getDb(), buyer.id, Number(field(form, "orderId")));
  });
}

export async function confirmDeliveryAction(form: FormData) {
  const orderId = Number(field(form, "orderId"));
  return runAction("/buyer", async () => {
    const buyer = await requireSessionRole("buyer");
    await confirmDelivery(await getDb(), buyer.id, orderId);
    return `/buyer/orders/${orderId}`;
  });
}

export async function markPaidAction(form: FormData) {
  const orderId = Number(field(form, "orderId"));
  return runAction(`/buyer/orders/${orderId}`, async () => {
    const buyer = await requireSessionRole("buyer");
    await markPayoutSent(await getDb(), buyer.id, Number(field(form, "payoutId")), field(form, "reference"));
  });
}
