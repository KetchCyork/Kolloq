#!/usr/bin/env node
/**
 * Desktop Node execution context — the sidecar.
 *
 * The Tauri desktop shell's front-end is the browser bundle, which has no Node runtime and can't run
 * the Node-only tools (the Office generators; fs/shell/code-interpreter later). This short-lived
 * process is that runtime: the Rust host spawns it per tool call, writes one JSON request to stdin,
 * and reads one JSON response from stdout. All the real logic lives in `@newvector/core`'s
 * `handleNodeToolRequest`; this file is just the stdin→handler→stdout shell.
 *
 * Protocol (see `NodeToolRequest` / `NodeToolResponse` in core):
 *   stdin  <- {"op":"exec","sandboxRoot":"…","name":"generate_word_document","args":{…}}
 *   stdout -> {"ok":true,"result":{…}}                       // or {"ok":false,"error":"…"}
 *   stdin  <- {"op":"read","sandboxRoot":"…","path":"report.docx"}
 *   stdout -> {"ok":true,"contentBase64":"…","mimeType":"…","bytesRead":123}
 *
 * The `sandboxRoot` is resolved and created by the trusted Rust host, never by the model. The process
 * always exits 0 after emitting a response (including for handled errors); a non-zero exit means the
 * runtime itself failed to start, which the host surfaces as a spawn error.
 */
import { handleNodeToolRequest } from "@newvector/core/node";

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  let response;
  try {
    const raw = await readStdin();
    const request = JSON.parse(raw);
    response = await handleNodeToolRequest(request);
  } catch (err) {
    response = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  process.stdout.write(JSON.stringify(response));
}

main().then(
  () => process.exit(0),
  (err) => {
    // Should be unreachable (main catches its own errors), but never leave the host hanging.
    process.stdout.write(JSON.stringify({ ok: false, error: String(err) }));
    process.exit(0);
  },
);
