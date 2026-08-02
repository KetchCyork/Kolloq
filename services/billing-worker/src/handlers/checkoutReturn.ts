/**
 * Public (unauthenticated) landing page for Stripe redirects.
 *
 * The Kolloq client is a desktop app with no web server of its own (see product spec — Checkout
 * and the Customer Portal are opened in the user's system browser via `openExternalUrl`, same as
 * Google sign-in in NEW-195). Stripe still needs a real `https://` URL to redirect back to when the
 * user finishes or cancels, and there's nothing else deployed yet to host that page, so the worker
 * serves it itself. The app never observes this navigation — it has no way to; it picks up the new
 * plan by re-fetching GET /entitlement when the window regains focus (SettingsAccountPlanPane.tsx).
 */
const STATUS_COPY: Record<string, { title: string; body: string }> = {
  success: {
    title: "You're upgraded",
    body: "Your subscription is active. Close this tab and switch back to Kolloq — your plan updates automatically.",
  },
  cancelled: {
    title: "Checkout cancelled",
    body: "No changes were made. Close this tab and switch back to Kolloq whenever you're ready.",
  },
  portal: {
    title: "Billing updated",
    body: "Close this tab and switch back to Kolloq — any changes update automatically.",
  },
};

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} — Kolloq</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0b1512; color: #eef2f0; display: flex;
    align-items: center; justify-content: center; height: 100vh; margin: 0; }
  main { max-width: 28rem; text-align: center; padding: 2rem; }
  h1 { font-size: 1.25rem; margin-bottom: 0.5rem; }
  p { color: #9fb0aa; line-height: 1.5; }
</style>
</head>
<body>
<main>
  <h1>${title}</h1>
  <p>${body}</p>
</main>
</body>
</html>`;
}

export function handleCheckoutReturn(request: Request): Response {
  const status = new URL(request.url).searchParams.get("status") ?? "";
  const copy = STATUS_COPY[status] ?? STATUS_COPY.success;
  return new Response(page(copy.title, copy.body), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
