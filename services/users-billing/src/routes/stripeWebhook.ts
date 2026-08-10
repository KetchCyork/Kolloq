import type { FastifyInstance } from "fastify";
import type { createDb } from "../db/client.js";
import { syncSubscriptionByStripeId } from "../db/subscriptions.js";
import { verifyStripeSignature } from "../webhookSignature.js";

interface StripeSubscriptionObject {
  id: string;
  status: string;
  current_period_end: number;
}

interface StripeInvoiceObject {
  subscription: string | null;
  period_end: number | null;
  lines?: { data: Array<{ period?: { end: number } }> };
}

interface StripeEvent {
  type: string;
  data: { object: unknown };
}

function toDate(seconds: number | null | undefined): Date | null {
  return typeof seconds === "number" ? new Date(seconds * 1000) : null;
}

function invoicePeriodEnd(invoice: StripeInvoiceObject): number | null {
  return invoice.period_end ?? invoice.lines?.data?.[0]?.period?.end ?? null;
}

export interface WebhookLogEntry {
  receivedAt: string;
  verified: boolean;
  eventType?: string;
}

/** Temporary NEW-230 smoke-test diagnostic — ring buffer, no PII/secrets, cleared on restart. */
export const webhookLog: WebhookLogEntry[] = [];
const WEBHOOK_LOG_LIMIT = 20;

function recordWebhookLog(entry: WebhookLogEntry): void {
  webhookLog.push(entry);
  if (webhookLog.length > WEBHOOK_LOG_LIMIT) webhookLog.shift();
}

export function registerStripeWebhookRoute(app: FastifyInstance, db: ReturnType<typeof createDb>["db"]): void {
  // Encapsulated so this raw-body parser only applies to this route, not the rest of the app.
  app.register(async (instance) => {
    instance.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => {
      done(null, body);
    });

    instance.post("/webhooks/stripe", async (request, reply) => {
      const secret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!secret) {
        request.log.error("STRIPE_WEBHOOK_SECRET is not set");
        return reply.code(500).send({ error: "webhook_not_configured" });
      }

      const rawBody = request.body as string;
      const signatureHeader = request.headers["stripe-signature"];
      const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

      if (!verifyStripeSignature(rawBody, signature, secret)) {
        recordWebhookLog({ receivedAt: new Date().toISOString(), verified: false });
        return reply.code(400).send({ error: "invalid_signature" });
      }

      const event = JSON.parse(rawBody) as StripeEvent;
      recordWebhookLog({ receivedAt: new Date().toISOString(), verified: true, eventType: event.type });

      switch (event.type) {
        case "customer.subscription.updated": {
          const sub = event.data.object as StripeSubscriptionObject;
          await syncSubscriptionByStripeId(db, sub.id, { status: sub.status, currentPeriodEnd: toDate(sub.current_period_end) });
          break;
        }
        case "customer.subscription.deleted": {
          const sub = event.data.object as StripeSubscriptionObject;
          await syncSubscriptionByStripeId(db, sub.id, { status: "canceled", currentPeriodEnd: toDate(sub.current_period_end) });
          break;
        }
        case "invoice.paid": {
          const invoice = event.data.object as StripeInvoiceObject;
          if (invoice.subscription) {
            await syncSubscriptionByStripeId(db, invoice.subscription, { status: "active", currentPeriodEnd: toDate(invoicePeriodEnd(invoice)) });
          }
          break;
        }
        case "invoice.payment_failed": {
          const invoice = event.data.object as StripeInvoiceObject;
          if (invoice.subscription) {
            await syncSubscriptionByStripeId(db, invoice.subscription, { status: "past_due" });
          }
          break;
        }
        default:
          break; // Unhandled event types are acknowledged and ignored.
      }

      return reply.send({ received: true });
    });
  });
}
