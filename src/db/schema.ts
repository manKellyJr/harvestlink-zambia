/**
 * Database schema (single source of truth for data structure).
 *
 * Money is always stored as integer ngwee (1 ZMW = 100 ngwee) so that no
 * floating point rounding ever touches a farmer's payment. Weights are integer
 * kilograms.
 */
import {
  pgTable,
  pgEnum,
  serial,
  integer,
  text,
  timestamp,
  boolean,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["farmer", "buyer", "transporter", "admin"]);
export const walletProviderEnum = pgEnum("wallet_provider", ["mtn", "airtel", "zamtel"]);
export const lotStatusEnum = pgEnum("lot_status", [
  "listed", // some kilograms still available at the collection point
  "sold_out", // every kilogram is allocated to buyer orders
  "cancelled", // withdrawn by the farmer before any allocation
]);
export const orderStatusEnum = pgEnum("order_status", [
  "allocated", // supply reserved from farmer lots, waiting for a transporter
  "assigned", // a transporter accepted the job
  "picked_up", // transporter collected the produce from the collection point
  "delivered", // buyer confirmed delivery; farmers are now owed payment
  "completed", // every farmer and the transporter confirmed payment
  "cancelled",
]);
export const payoutStatusEnum = pgEnum("payout_status", [
  "owed", // created on delivery; buyer must pay the farmer's wallet directly
  "buyer_marked_paid", // buyer says they sent it (with a mobile money reference)
  "confirmed", // payee confirmed receipt over USSD
  "disputed", // payee said they did not receive it
]);
export const payeeTypeEnum = pgEnum("payee_type", ["farmer", "transporter"]);

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    phone: text("phone").notNull(), // E.164, e.g. +260971234567
    name: text("name").notNull(),
    role: roleEnum("role").notNull(),
    district: text("district"),
    walletProvider: walletProviderEnum("wallet_provider"),
    // Explicit consent to store and process personal data (Data Protection Act 2021).
    consentAt: timestamp("consent_at", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_phone_idx").on(t.phone)],
);

export const collectionPoints = pgTable("collection_points", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  district: text("district").notNull(),
  province: text("province").notNull(),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const lots = pgTable(
  "lots",
  {
    id: serial("id").primaryKey(),
    farmerId: integer("farmer_id")
      .notNull()
      .references(() => users.id),
    collectionPointId: integer("collection_point_id")
      .notNull()
      .references(() => collectionPoints.id),
    crop: text("crop").notNull(),
    quantityKg: integer("quantity_kg").notNull(),
    // Kilograms not yet allocated to any order.
    availableKg: integer("available_kg").notNull(),
    // Farmer's minimum acceptable price; lots are only matched to orders paying at least this.
    minPricePerKgNgwee: integer("min_price_per_kg_ngwee").notNull(),
    status: lotStatusEnum("status").notNull().default("listed"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("lots_matching_idx").on(t.collectionPointId, t.crop, t.status)],
);

export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  buyerId: integer("buyer_id")
    .notNull()
    .references(() => users.id),
  collectionPointId: integer("collection_point_id")
    .notNull()
    .references(() => collectionPoints.id),
  crop: text("crop").notNull(),
  quantityKg: integer("quantity_kg").notNull(),
  pricePerKgNgwee: integer("price_per_kg_ngwee").notNull(),
  transportFeeNgwee: integer("transport_fee_ngwee").notNull(),
  deliveryAddress: text("delivery_address").notNull(),
  transporterId: integer("transporter_id").references(() => users.id),
  status: orderStatusEnum("status").notNull().default("allocated"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
});

/** Which farmer lots (and how many kg of each) fill an order. */
export const allocations = pgTable(
  "allocations",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id),
    lotId: integer("lot_id")
      .notNull()
      .references(() => lots.id),
    quantityKg: integer("quantity_kg").notNull(),
  },
  (t) => [index("allocations_order_idx").on(t.orderId)],
);

/**
 * A payment the buyer owes directly to a farmer or transporter. HarvestLink
 * never receives or holds these funds: it only records what is owed and the
 * confirmations from both sides.
 */
export const payouts = pgTable(
  "payouts",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id),
    payeeId: integer("payee_id")
      .notNull()
      .references(() => users.id),
    payeeType: payeeTypeEnum("payee_type").notNull(),
    amountNgwee: integer("amount_ngwee").notNull(),
    walletProvider: walletProviderEnum("wallet_provider").notNull(),
    walletPhone: text("wallet_phone").notNull(),
    status: payoutStatusEnum("status").notNull().default("owed"),
    buyerReference: text("buyer_reference"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("payouts_payee_idx").on(t.payeeId, t.status)],
);

/** Append-only log of every state change, for auditability and dispute handling. */
export const auditEvents = pgTable("audit_events", {
  id: serial("id").primaryKey(),
  actorId: integer("actor_id").references(() => users.id),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: integer("entity_id").notNull(),
  details: jsonb("details"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Every SMS we send, so delivery problems can be traced. */
export const smsOutbox = pgTable("sms_outbox", {
  id: serial("id").primaryKey(),
  phone: text("phone").notNull(),
  body: text("body").notNull(),
  status: text("status").notNull().default("queued"),
  providerRef: text("provider_ref"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One-time login codes for the buyer web app. Only a hash of the code is stored. */
export const loginCodes = pgTable("login_codes", {
  id: serial("id").primaryKey(),
  phone: text("phone").notNull(),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type CollectionPoint = typeof collectionPoints.$inferSelect;
export type Lot = typeof lots.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type Payout = typeof payouts.$inferSelect;
export type Role = (typeof roleEnum.enumValues)[number];
export type WalletProvider = (typeof walletProviderEnum.enumValues)[number];
