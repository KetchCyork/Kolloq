import { useEffect, useRef, useState } from "react";

/**
 * In-app confirm/alert/prompt dialogs.
 *
 * The desktop shell (Tauri/wry) implements none of the WKUIDelegate methods, so the
 * native window.confirm()/prompt()/alert() APIs silently no-op there — confirm() returns
 * false, prompt() returns null, alert() shows nothing (see NEW-206). These state-driven
 * React dialogs render identically in the browser and the Tauri webview with no Rust
 * change needed. Call the imperative helpers (confirmDialog/alertDialog/promptDialog);
 * they return a Promise, so a call site reads almost exactly like the native API it
 * replaces — just `await` it.
 *
 * The controller below is framework-agnostic on purpose: the helpers can be called from
 * non-React modules too (e.g. desktopIntegration.ts), and <DialogHost/> is only a thin
 * subscriber that renders whatever is queued.
 */

export interface ConfirmOptions {
  title?: string;
  message: string;
  /** Label for the affirmative button. Defaults to "OK". */
  confirmLabel?: string;
  /** Label for the dismissive button. Defaults to "Cancel". */
  cancelLabel?: string;
  /** Style the affirmative button as destructive (red). */
  danger?: boolean;
}

export interface AlertOptions {
  title?: string;
  message: string;
  /** Label for the dismiss button. Defaults to "OK". */
  confirmLabel?: string;
}

export interface PromptOptions {
  title?: string;
  message: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export type DialogRequest =
  | { id: number; kind: "confirm"; opts: ConfirmOptions; resolve: (value: boolean) => void }
  | { id: number; kind: "alert"; opts: AlertOptions; resolve: (value: void) => void }
  | { id: number; kind: "prompt"; opts: PromptOptions; resolve: (value: string | null) => void };

type Listener = (queue: DialogRequest[]) => void;

let queue: DialogRequest[] = [];
let listener: Listener | null = null;
let nextId = 1;

function emit(): void {
  listener?.(queue.slice());
}

/** Subscribe the (single) renderer to the dialog queue. Returns an unsubscribe fn. */
export function subscribeDialogs(next: Listener): () => void {
  listener = next;
  emit();
  return () => {
    if (listener === next) listener = null;
  };
}

function enqueue(request: DialogRequest): void {
  queue = [...queue, request];
  emit();
}

/** Called by the renderer when the user answers the active dialog. */
export function resolveDialog(id: number, value: boolean | string | null | void): void {
  const request = queue.find((entry) => entry.id === id);
  if (!request) return;
  queue = queue.filter((entry) => entry.id !== id);
  emit();
  (request.resolve as (value: unknown) => void)(value);
}

/** Ask the user to confirm. Resolves true if they accept, false otherwise. Replaces window.confirm. */
export function confirmDialog(input: ConfirmOptions | string): Promise<boolean> {
  const opts = typeof input === "string" ? { message: input } : input;
  return new Promise<boolean>((resolve) => enqueue({ id: nextId++, kind: "confirm", opts, resolve }));
}

/** Show a message the user must acknowledge. Resolves when dismissed. Replaces window.alert. */
export function alertDialog(input: AlertOptions | string): Promise<void> {
  const opts = typeof input === "string" ? { message: input } : input;
  return new Promise<void>((resolve) => enqueue({ id: nextId++, kind: "alert", opts, resolve }));
}

/** Ask the user for a line of text. Resolves the entered string, or null if cancelled. Replaces window.prompt. */
export function promptDialog(input: PromptOptions | string): Promise<string | null> {
  const opts = typeof input === "string" ? { message: input } : input;
  return new Promise<string | null>((resolve) => enqueue({ id: nextId++, kind: "prompt", opts, resolve }));
}

/**
 * Renders the active dialog. Mount once near the app root, above any other overlay
 * (its z-index sits above modals/drawers so a confirm fired from inside a modal — e.g.
 * deleting a connection in Settings — stacks on top). Dialogs are shown one at a time
 * in the order requested.
 */
export function DialogHost(): JSX.Element | null {
  const [pending, setPending] = useState<DialogRequest[]>([]);
  useEffect(() => subscribeDialogs(setPending), []);

  const active = pending[0];
  if (!active) return null;
  return <Dialog key={active.id} request={active} />;
}

function Dialog({ request }: { request: DialogRequest }): JSX.Element {
  const { opts } = request;
  const [text, setText] = useState(request.kind === "prompt" ? request.opts.defaultValue ?? "" : "");
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  function accept(): void {
    if (request.kind === "confirm") resolveDialog(request.id, true);
    else if (request.kind === "prompt") resolveDialog(request.id, text);
    else resolveDialog(request.id, undefined);
  }

  function cancel(): void {
    if (request.kind === "confirm") resolveDialog(request.id, false);
    else if (request.kind === "prompt") resolveDialog(request.id, null);
    else resolveDialog(request.id, undefined);
  }

  // Focus the input (prompt) or the affirmative button so Enter works immediately.
  useEffect(() => {
    (request.kind === "prompt" ? inputRef.current : confirmRef.current)?.focus();
  }, [request.kind]);

  const dismissible = request.kind !== "alert";
  const confirmLabel = opts.confirmLabel ?? "OK";
  const cancelLabel = (request.kind === "confirm" || request.kind === "prompt") ? request.opts.cancelLabel ?? "Cancel" : "Cancel";
  const danger = request.kind === "confirm" && request.opts.danger;

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    } else if (event.key === "Enter" && request.kind !== "prompt") {
      event.preventDefault();
      accept();
    }
  }

  return (
    <div className="modal-overlay dialog-overlay" onClick={() => dismissible && cancel()}>
      <div
        className="modal dialog"
        role={request.kind === "alert" ? "alertdialog" : "dialog"}
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {opts.title && (
          <div className="modal-header">
            <h2>{opts.title}</h2>
          </div>
        )}
        <div className="dialog-body">
          <p className="dialog-message">{opts.message}</p>
          {request.kind === "prompt" && (
            <input
              ref={inputRef}
              className="dialog-input"
              value={text}
              placeholder={request.opts.placeholder}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  accept();
                }
              }}
            />
          )}
        </div>
        <div className="dialog-actions">
          {request.kind !== "alert" && (
            <button className="dialog-btn dialog-btn-ghost" onClick={cancel}>
              {cancelLabel}
            </button>
          )}
          <button
            ref={confirmRef}
            className={`dialog-btn dialog-btn-primary${danger ? " dialog-btn-danger" : ""}`}
            onClick={accept}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
