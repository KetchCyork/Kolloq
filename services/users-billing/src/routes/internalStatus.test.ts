import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../db/client.js";
import { subscriptions, users } from "../db/schema.js";
import { registerInternalStatusRoute } from "./internalStatus.js";

const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)("GET /internal/subscriptions/:stripeSubscriptionId", () => {
  let ctx: ReturnType<typeof createDb>;
  let app: FastifyInstance;

  beforeAll(async () => {
    ctx = createDb(DATABASE_URL);
    await migrate(ctx.db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
    app = Fastify();
    registerInternalStatusRoute(app, ctx.db);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await ctx.pool.end();
  });

  it("returns the current status for a known Stripe subscription id", async () => {
    const stripeSubscriptionId = `sub_${randomUUID()}`;
    const [user] = await ctx.db
      .insert(users)
      .values({ firstName: "Ada", lastName: "Lovelace", email: `ada-${randomUUID()}@example.com` })
      .returning();
    await ctx.db.insert(subscriptions).values({
      userId: user.id,
      plan: "pro",
      status: "active",
      stripeCustomerId: `cus_${randomUUID()}`,
      stripeSubscriptionId,
      stripePriceId: "price_1TxWR3GgrGbDWiCh6h4mm1mX",
    });

    const response = await app.inject({ method: "GET", url: `/internal/subscriptions/${stripeSubscriptionId}` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "active" });
  });

  it("returns 404 for an unknown Stripe subscription id", async () => {
    const response = await app.inject({ method: "GET", url: "/internal/subscriptions/sub_does_not_exist" });
    expect(response.statusCode).toBe(404);
  });
});
