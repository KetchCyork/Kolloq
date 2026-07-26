#!/usr/bin/env bash
# One-command rebuild + install of the canonical desktop build to
# /Applications/Kolloq.app.
#
# This machine shares one repo across many agent worktrees, and "does
# /Applications have my change" used to mean a manual build + drag-and-drop
# that's easy to run from the wrong branch or skip entirely — that's what
# turned NEW-120 into a three-worktree binary-forensics investigation.
# /Applications is the single shared, main-only canonical install (see
# AGENTS.md); this script refuses to put a dirty checkout, a non-`main`
# branch, or a stale `main` there without an explicit --force.
#
# Usage: pnpm desktop:install [--force]
set -euo pipefail

FORCE=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    *)
      echo "unknown argument: $arg" >&2
      echo "usage: pnpm desktop:install [--force]" >&2
      exit 1
      ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$REPO_ROOT"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
SHA="$(git rev-parse --short HEAD)"

if [[ -n "$(git status --porcelain)" ]]; then
  if [[ "$FORCE" -eq 0 ]]; then
    echo "error: working tree is dirty — refusing to install an unclean build to /Applications." >&2
    echo "       commit or stash your changes, or re-run with --force to install anyway." >&2
    git status --short >&2
    exit 1
  fi
  echo "warning: working tree is dirty — installing anyway because of --force." >&2
fi

if [[ "$BRANCH" != "main" ]]; then
  if [[ "$FORCE" -eq 0 ]]; then
    echo "error: on branch '${BRANCH}', not 'main' — refusing to install a non-main build to /Applications." >&2
    echo "       /Applications is the shared canonical main-only build (see AGENTS.md); build and" >&2
    echo "       install a branch build elsewhere instead, or re-run with --force if you really" >&2
    echo "       mean to install this branch to /Applications." >&2
    exit 1
  fi
  echo "warning: on branch '${BRANCH}', not 'main' — installing anyway because of --force." >&2
fi

if git fetch origin main --quiet 2>/dev/null && git rev-parse --verify --quiet origin/main >/dev/null; then
  BEHIND="$(git rev-list --count HEAD..origin/main)"
  if [[ "$BEHIND" -gt 0 ]]; then
    if [[ "$FORCE" -eq 0 ]]; then
      echo "error: HEAD is ${BEHIND} commit(s) behind origin/main — refusing a stale install." >&2
      echo "       pull the latest main, or re-run with --force to install this commit anyway." >&2
      exit 1
    fi
    echo "warning: HEAD is ${BEHIND} commit(s) behind origin/main — installing anyway because of --force." >&2
  fi
else
  echo "warning: could not reach origin/main — skipping the drift check." >&2
fi

echo "==> Building desktop bundle from ${BRANCH}@${SHA}"
pnpm --filter @newvector/desktop build

BUNDLE_SRC="apps/desktop/src-tauri/target/release/bundle/macos/Kolloq.app"
if [[ ! -d "$BUNDLE_SRC" ]]; then
  echo "error: expected bundle not found at: $BUNDLE_SRC" >&2
  exit 1
fi

DEST="/Applications/Kolloq.app"
echo "==> Installing to ${DEST}"
rm -rf "$DEST"
cp -R "$BUNDLE_SRC" "$DEST"

echo "==> Installed Kolloq.app built from ${BRANCH}@${SHA}"
echo "==> Verify in-app: Settings → General → About should show ${SHA}"
