import { isTauriRuntime } from "./credentials";

/**
 * Wires the native menu (File > New Session, Help > Check for Updates) and
 * the Tauri updater into the React app. No-ops entirely in the plain browser
 * build, where none of these APIs exist.
 */
export async function setupDesktopIntegration(handlers: { onNewSession: () => void }): Promise<() => void> {
  if (!isTauriRuntime()) return () => {};

  const [{ listen }, updater] = await Promise.all([
    import("@tauri-apps/api/event"),
    import("@tauri-apps/plugin-updater"),
  ]);

  const unlistenNewSession = await listen("menu://new-session", () => handlers.onNewSession());
  const unlistenCheckUpdates = await listen("menu://check-updates", () => {
    void checkForUpdate(updater);
  });

  return () => {
    unlistenNewSession();
    unlistenCheckUpdates();
  };
}

async function checkForUpdate(updater: typeof import("@tauri-apps/plugin-updater")): Promise<void> {
  const update = await updater.check();
  if (!update) {
    window.alert("You're on the latest version.");
    return;
  }
  const shouldInstall = window.confirm(
    `Open Work ${update.version} is available. Download and install now?`,
  );
  if (!shouldInstall) return;

  await update.downloadAndInstall();
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
