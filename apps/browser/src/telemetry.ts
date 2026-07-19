/**
 * Telemetry module — provider-agnostic interface with a no-op backend.
 *
 * Telemetry is OFF by default (controlled by Preferences.telemetryEnabled).
 * All captures are no-ops until the user explicitly opts in.
 *
 * When a backend is wired up (PostHog SaaS or self-hosted — pending CEO vendor
 * decision; see NEW-50), replace `noopBackend` with a real implementation that
 * conforms to `TelemetryBackend` and pass it to `initTelemetry`. No other code
 * needs to change.
 *
 * Events must never include personally identifiable information or API key material.
 */

export type TelemetryEvent =
  | { type: "session_created"; provider: string }
  | { type: "message_sent"; provider: string; toolCount: number }
  | { type: "tool_call"; toolName: string }
  | { type: "provider_error"; provider: string }
  | { type: "onboarding_completed"; provider: string };

export interface TelemetryBackend {
  capture(event: TelemetryEvent): void;
}

const noopBackend: TelemetryBackend = {
  capture: () => undefined,
};

let enabled = false;
let backend: TelemetryBackend = noopBackend;

export function initTelemetry(opts: { backend?: TelemetryBackend }): void {
  if (opts.backend) backend = opts.backend;
}

export function setTelemetryEnabled(on: boolean): void {
  enabled = on;
}

export function capture(event: TelemetryEvent): void {
  if (!enabled) return;
  try {
    backend.capture(event);
  } catch {
    // Telemetry must never crash the app.
  }
}
