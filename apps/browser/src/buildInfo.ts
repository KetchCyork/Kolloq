export interface BuildInfo {
  sha: string;
  branch: string;
  dirty: boolean;
  time: string;
}

/** Injected by `vite.config.ts` via `define` — same values whether running as the browser app or the Tauri window. */
export const BUILD_INFO: BuildInfo = {
  sha: __BUILD_SHA__,
  branch: __BUILD_BRANCH__,
  dirty: __BUILD_DIRTY__,
  time: __BUILD_TIME__,
};

export function formatBuildLabel(info: BuildInfo): string {
  const shaLabel = info.dirty ? `${info.sha}-dirty` : info.sha;
  return `${shaLabel} on ${info.branch}`;
}
