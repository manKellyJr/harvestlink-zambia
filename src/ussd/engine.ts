/**
 * USSD menus for farmers and transporters (works on any phone, no data bundle).
 *
 * The gateway (Africa's Talking) sends the whole input path on every request as
 * `text`, e.g. "1*2*500" = chose 1, then 2, then typed 500. The engine is
 * stateless: it re-reads the path each time, so a dropped session simply
 * restarts at the main menu without corrupting anything. Responses starting
 * with "CON" keep the session open; "END" closes it.
 */
import type { Db } from "@/db/client";
import type { User, WalletProvider } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import { pilot } from "@/domain/config";
import { formatKwacha, parseKwacha } from "@/domain/money";
import { normalisePhone } from "@/domain/phone";
import { findUserByPhone, registerUser } from "@/domain/users";
import { listActiveCollectionPoints, listLot, lotsForFarmer } from "@/domain/lots";
import { acceptJob, activeJobsFor, markPickedUp, openJobsFor } from "@/domain/orders";
import { confirmPayout, pendingPayoutsFor } from "@/domain/payouts";
import { recentPrices } from "@/domain/prices";

const con = (s: string) => `CON ${s}`;
const end = (s: string) => `END ${s}`;
const menu = (title: string, items: string[]) => [title, ...items.map((t, i) => `${i + 1}. ${t}`)].join("\n");

/** Pick the n-th (1-based) item from a list chosen on a previous screen. */
function pick<T>(items: T[], choice: string | undefined): T {
  const i = Number(choice) - 1;
  if (!Number.isInteger(i) || i < 0 || i >= items.length) throw new DomainError("Invalid choice. Please dial again.");
  return items[i];
}

export async function handleUssd(db: Db, req: { phoneNumber: string; text: string }): Promise<string> {
  try {
    const phone = normalisePhone(req.phoneNumber);
    const path = req.text === "" ? [] : req.text.split("*");
    const user = await findUserByPhone(db, phone);
    if (!user) return await registration(db, phone, path);
    if (!user.active) return end("Your account is suspended. Please contact HarvestLink.");
    if (user.role === "farmer") return await farmerMenu(db, user, path);
    if (user.role === "transporter") return await transporterMenu(db, user, path);
    return end("Please use the HarvestLink website.");
  } catch (err) {
    if (err instanceof DomainError) return end(err.message);
    console.error("USSD error", err);
    return end("Sorry, something went wrong. Please try again later.");
  }
}

const wallets: WalletProvider[] = ["mtn", "airtel", "zamtel"];

async function registration(db: Db, phone: string, path: string[]): Promise<string> {
  const [role, name, district, wallet, consent] = path;
  if (role === undefined) return con(menu("Welcome to HarvestLink", ["Register as farmer", "Register as transporter"]));
  const r = pick(["farmer", "transporter"] as const, role);
  if (name === undefined) return con("Enter your full name");
  if (district === undefined) return con("Enter your district");
  if (wallet === undefined) return con(menu("Mobile money wallet for payments:", ["MTN MoMo", "Airtel Money", "Zamtel Kwacha"]));
  const w = pick(wallets, wallet);
  if (consent === undefined) {
    return con(
      menu("HarvestLink will store your name, phone and district to connect you with buyers. We never share them for marketing.", [
        "I agree",
        "Cancel",
      ]),
    );
  }
  if (consent !== "1") return end("Registration cancelled.");
  await registerUser(db, { phone, name, role: r, district, walletProvider: w, consent: true });
  return end(`Welcome ${name.trim()}! You are registered. Dial again to ${r === "farmer" ? `sell ${pilot.crop}` : "see jobs"}.`);
}

async function farmerMenu(db: Db, user: User, path: string[]): Promise<string> {
  const [choice, ...rest] = path;
  if (choice === undefined) {
    return con(menu(`HarvestLink - ${user.name}`, [`Sell ${pilot.crop}`, "My lots", "Confirm payment", "Prices"]));
  }
  switch (choice) {
    case "1":
      return sellFlow(db, user, rest);
    case "2": {
      const rows = (await lotsForFarmer(db, user.id)).slice(0, 4);
      if (rows.length === 0) return end("You have no lots yet.");
      const lines = rows.map(({ lot }) => `#${lot.id} ${lot.quantityKg}kg ${lotStatusLabel(lot.status, lot.availableKg)}`);
      return end(lines.join("\n"));
    }
    case "3":
      return confirmPaymentFlow(db, user, rest);
    case "4": {
      const prices = await recentPrices(db, user.district ?? "");
      if (prices.length === 0) return end(`No recent ${pilot.crop} buyer prices in your area yet.`);
      return end([`Recent buyer prices (${pilot.crop}):`, ...prices.map((p) => `${p.collectionPoint}: ${formatKwacha(p.pricePerKgNgwee)}/kg`)].join("\n"));
    }
    default:
      return end("Invalid choice. Please dial again.");
  }
}

function lotStatusLabel(status: string, availableKg: number) {
  if (status === "listed") return `${availableKg}kg unsold`;
  if (status === "sold_out") return "sold";
  return status;
}

async function sellFlow(db: Db, user: User, path: string[]): Promise<string> {
  const [cpChoice, qty, price, confirm] = path;
  const points = await listActiveCollectionPoints(db, user.district ?? undefined);
  if (points.length === 0) return end("No collection point in your district yet. We will SMS you when one opens.");
  if (cpChoice === undefined) return con(menu("Choose collection point:", points.slice(0, 6).map((p) => p.name)));
  const cp = pick(points.slice(0, 6), cpChoice);
  if (qty === undefined) return con("Enter quantity in kg (minimum 50, one bag)");
  const kg = Number(qty);
  if (!Number.isInteger(kg)) throw new DomainError("Enter the quantity as a whole number of kg");
  if (price === undefined) return con("Enter the lowest price per kg you accept, in Kwacha (e.g. 9.50)");
  const ngwee = parseKwacha(price);
  if (confirm === undefined) {
    return con(menu(`Sell ${kg}kg ${pilot.crop} at ${cp.name} for at least ${formatKwacha(ngwee)}/kg?`, ["Confirm", "Cancel"]));
  }
  if (confirm !== "1") return end("Cancelled. Nothing was listed.");
  const lot = await listLot(db, user.id, { collectionPointId: cp.id, quantityKg: kg, minPricePerKgNgwee: ngwee });
  return end(`Listed as lot #${lot.id}. We will SMS you when a buyer reserves it.`);
}

async function confirmPaymentFlow(db: Db, user: User, path: string[]): Promise<string> {
  const [itemChoice, answer] = path;
  const pending = await pendingPayoutsFor(db, user.id);
  if (pending.length === 0) return end("No payments waiting for confirmation.");
  if (itemChoice === undefined) {
    return con(menu("Which payment?", pending.map((p) => `${formatKwacha(p.amountNgwee)} order #${p.orderId}`)));
  }
  const p = pick(pending, itemChoice);
  if (answer === undefined) {
    const ref = p.buyerReference ? ` Buyer ref: ${p.buyerReference}.` : "";
    return con(menu(`Did you receive ${formatKwacha(p.amountNgwee)} in your wallet?${ref}`, ["Yes, received", "No, not received"]));
  }
  const received = answer === "1";
  await confirmPayout(db, user.id, p.id, received);
  return end(received ? "Thank you. Payment confirmed." : "We have told the buyer. HarvestLink will follow up.");
}

async function transporterMenu(db: Db, user: User, path: string[]): Promise<string> {
  const [choice, item, action] = path;
  if (choice === undefined) return con(menu(`HarvestLink - ${user.name}`, ["Available jobs", "My jobs", "Confirm payment"]));
  if (choice === "1") {
    const jobs = await openJobsFor(db, user.id);
    if (jobs.length === 0) return end("No jobs in your district right now. We SMS you when one appears.");
    if (item === undefined) {
      return con(menu("Available jobs:", jobs.map(({ order, collectionPoint }) => `#${order.id} ${order.quantityKg}kg ${collectionPoint}`)));
    }
    const { order, collectionPoint } = pick(jobs, item);
    if (action === undefined) {
      return con(
        menu(`#${order.id}: ${order.quantityKg}kg from ${collectionPoint} to ${order.deliveryAddress}. Fee ${formatKwacha(order.transportFeeNgwee)}.`, [
          "Accept",
          "Back",
        ]),
      );
    }
    if (action !== "1") return end("Not accepted.");
    await acceptJob(db, user.id, order.id);
    return end(`Job #${order.id} is yours. Collect from ${collectionPoint}, then mark it picked up under My jobs.`);
  }
  if (choice === "2") {
    const jobs = await activeJobsFor(db, user.id);
    if (jobs.length === 0) return end("You have no active jobs.");
    if (item === undefined) {
      return con(menu("My jobs:", jobs.map(({ order }) => `#${order.id} ${order.status === "assigned" ? "to collect" : "in transit"}`)));
    }
    const { order } = pick(jobs, item);
    if (order.status !== "assigned") return end(`Job #${order.id} is in transit. The buyer confirms delivery.`);
    if (action === undefined) return con(menu(`Job #${order.id}: have you collected ${order.quantityKg}kg?`, ["Yes, picked up", "Back"]));
    if (action !== "1") return end("No change.");
    await markPickedUp(db, user.id, order.id);
    return end(`Job #${order.id} marked picked up. Deliver to ${order.deliveryAddress}.`);
  }
  if (choice === "3") return confirmPaymentFlow(db, user, path.slice(1));
  return end("Invalid choice. Please dial again.");
}
