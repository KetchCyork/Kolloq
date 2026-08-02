import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "./client.js";
import { subscriptions, users } from "./schema.js";

const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)("users/subscriptions schema", () => {
  let ctx: ReturnType<typeof createDb>;

  beforeAll(async () => {
    ctx = createDb(DATABASE_URL);
    await migrate(ctx.db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
  });

  afterAll(async () => {
    await ctx.pool.end();
  });

  it("inserts a user and a linked subscription with Stripe reference IDs", async () => {
    const [user] = await ctx.db
      .insert(users)
      .values({ firstName: "Ada", lastName: "Lovelace", email: `ada-${randomUUID()}@example.com` })
      .returning();

    const [sub] = await ctx.db
      .insert(subscriptions)
      .values({
        userId: user.id,
        plan: "pro",
        status: "active",
        stripeCustomerId: `cus_${randomUUID()}`,
        stripeSubscriptionId: `sub_${randomUUID()}`,
      })
      .returning();

    expect(sub.userId).toBe(user.id);
  });

  it("enforces case-insensitive unique email via citext", async () => {
    const email = `Dupe-${randomUUID()}@Example.com`;
    await ctx.db.insert(users).values({ firstName: "A", lastName: "B", email });

    await expect(
      ctx.db.insert(users).values({ firstName: "C", lastName: "D", email: email.toLowerCase() }),
    ).rejects.toThrow();
  });

  it("enforces unique stripe_subscription_id", async () => {
    const [user] = await ctx.db
      .insert(users)
      .values({ firstName: "E", lastName: "F", email: `ef-${randomUUID()}@example.com` })
      .returning();
    const stripeSubscriptionId = `sub_${randomUUID()}`;

    await ctx.db.insert(subscriptions).values({
      userId: user.id,
      plan: "pro",
      status: "active",
      stripeCustomerId: `cus_${randomUUID()}`,
      stripeSubscriptionId,
    });

    await expect(
      ctx.db.insert(subscriptions).values({
        userId: user.id,
        plan: "pro",
        status: "active",
        stripeCustomerId: `cus_${randomUUID()}`,
        stripeSubscriptionId,
      }),
    ).rejects.toThrow();
  });

  it("enforces the subscriptions.user_id foreign key", async () => {
    await expect(
      ctx.db.insert(subscriptions).values({
        userId: randomUUID(),
        plan: "pro",
        status: "active",
        stripeCustomerId: `cus_${randomUUID()}`,
        stripeSubscriptionId: `sub_${randomUUID()}`,
      }),
    ).rejects.toThrow();
  });
});
