import { sql } from "drizzle-orm";
import {
  customType,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const citext = customType<{ data: string }>({
  dataType() {
    return "citext";
  },
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: citext("email").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
}, (table) => [
  uniqueIndex("users_email_unique").on(table.email),
]);

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id),
  plan: text("plan").notNull(),
  status: text("status").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().default(sql`now()`),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  // Stripe reference IDs only — never store raw card data, CVC, or a
  // one-time client token as a durable credential.
  stripeCustomerId: text("stripe_customer_id").notNull(),
  stripeSubscriptionId: text("stripe_subscription_id").notNull(),
  stripePriceId: text("stripe_price_id"),
  defaultPaymentMethodId: text("default_payment_method_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
}, (table) => [
  uniqueIndex("subscriptions_stripe_subscription_id_unique").on(table.stripeSubscriptionId),
  index("subscriptions_user_id_idx").on(table.userId),
  index("subscriptions_stripe_customer_id_idx").on(table.stripeCustomerId),
]);
