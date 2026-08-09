/**
 * Copy text to the clipboard, reliably, in both the browser and the desktop shell.
 *
 * The desktop app runs the same frontend inside Tauri's wry webview, where the async
 * Clipboard API (`navigator.clipboard.writeText`) is frequently unusable: the call is
 * gated on a secure context and an explicit clipboard-write permission the wry webview
 * does not grant, so it rejects. That rejection is exactly what surfaced to the user as
 * an "error copying text" message. This is the same class of gap NEW-206 documented for
 * window.confirm/prompt/alert (see dialogs.tsx): a web API that silently fails under wry.
 *
 * So we try the async API first (works in modern secure browsers), then fall back to the
 * legacy `document.execCommand("copy")` path, which works in insecure contexts and inside
 * the wry webview. Only when both fail do we throw, so callers can surface a real error.
 */
export async function copyText(text: string): Promise<void> {
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === "function" &&
    // isSecureContext is false for plain http:// and can be false in the wry webview;
    // the async Clipboard API rejects there, so only attempt it when it can succeed.
    typeof window !== "undefined" &&
    window.isSecureContext
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Permission denied or unavailable — fall through to the legacy path.
    }
  }

  if (legacyCopy(text)) return;

  throw new Error("Couldn't copy to the clipboard in this window.");
}

/**
 * Legacy clipboard write via a hidden, selected <textarea> and execCommand("copy").
 * Returns true on success. Works where the async Clipboard API is blocked, including
 * the Tauri/wry webview and insecure (http://) contexts.
 */
function legacyCopy(text: string): boolean {
  if (typeof document === "undefined") return false;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  // Keep it off-screen and out of layout so selecting it doesn't scroll or flash.
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  const previousSelection = document.getSelection()?.rangeCount
    ? document.getSelection()!.getRangeAt(0)
    : null;
  try {
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
    if (previousSelection) {
      const selection = document.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(previousSelection);
    }
  }
}
