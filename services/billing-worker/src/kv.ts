import { KV_PREFIX } from "./config";
import type { CustomerRecord, Env } from "./types";

export async function getCustomerIdForEmail(env: Env, email: string): Promise<string | null> {
  return env.BILLING_KV.get(`${KV_PREFIX.emailToCustomer}${email}`);
}

export async function setCustomerIdForEmail(env: Env, email: string, customerId: string): Promise<void> {
  await env.BILLING_KV.put(`${KV_PREFIX.emailToCustomer}${email}`, customerId);
}

export async function getCustomerRecord(env: Env, customerId: string): Promise<CustomerRecord | null> {
  const raw = await env.BILLING_KV.get(`${KV_PREFIX.customerRecord}${customerId}`);
  return raw ? (JSON.parse(raw) as CustomerRecord) : null;
}

export async function putCustomerRecord(env: Env, customerId: string, record: CustomerRecord): Promise<void> {
  await env.BILLING_KV.put(`${KV_PREFIX.customerRecord}${customerId}`, JSON.stringify(record));
  await setCustomerIdForEmail(env, record.email, customerId);
}
