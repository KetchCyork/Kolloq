#!/usr/bin/env bash
# Builds a QA/dev copy of the desktop app that cannot collide with the
# canonical /Applications/Kolloq.app install.
#
# The default `tauri build` uses the release identifier (ai.newvector.cowork)
# and product name ("Kolloq"), so any agent building from any branch and
# copying the result to /Applications overwrites whatever verified build was
# there and, because LaunchServices resolves by bundle identifier, can even
# redirect launches of the *existing* /Applications/Kolloq.app to a
# worktree's build output (see NEW-160).
#
# This script instead builds with a branch-suffixed identifier and product
# name, and installs to a scratch directory — never /Applications — so a QA
# install is always distinguishable from, and never overwrites, the
# canonical build.
#
# Usage:
#   pnpm --filter @newvector/desktop qa-build [--debug]
set -euo pipefail
cd "$(dirname "$0")/.."

"$(dirname "$0")/ensure-target-unindexed.sh"
"$(dirname "$0")/drain-stale-bundle.sh"

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
SLUG="$(printf '%s' "$BRANCH" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g')"
SLUG="${SLUG:-unknown}"

# productName feeds tauri.conf.json's `^[^/:*?"<>|]+$` validation (and macOS
# file/path rules), so it must use the sanitized slug, not the raw branch
# name (branches routinely contain "/").
PRODUCT_NAME="Kolloq (QA ${SLUG})"
IDENTIFIER="ai.newvector.cowork.qa.${SLUG}"

BUNDLE_SUBDIR="release"
DEBUG_FLAG=()
if [[ "${1:-}" == "--debug" ]]; then
  DEBUG_FLAG=(--debug)
  BUNDLE_SUBDIR="debug"
fi

OVERRIDE_FILE="$(mktemp -t openwork-qa-config).json"
trap 'rm -f "$OVERRIDE_FILE"' EXIT

cat > "$OVERRIDE_FILE" <<JSON
{
  "productName": "${PRODUCT_NAME}",
  "identifier": "${IDENTIFIER}",
  "app": {
    "windows": [
      { "title": "${PRODUCT_NAME}" }
    ]
  }
}
JSON

echo "==> Building QA bundle for branch '${BRANCH}'"
echo "    identifier:  ${IDENTIFIER}"
echo "    productName: ${PRODUCT_NAME}"
pnpm exec tauri build --config "$OVERRIDE_FILE" -b app "${DEBUG_FLAG[@]+"${DEBUG_FLAG[@]}"}"

BUNDLE_SRC="src-tauri/target/${BUNDLE_SUBDIR}/bundle/macos/${PRODUCT_NAME}.app"
if [[ ! -d "$BUNDLE_SRC" ]]; then
  echo "error: expected bundle not found at $BUNDLE_SRC" >&2
  exit 1
fi

DEST_DIR="${HOME}/Desktop/OpenWork-QA-Builds/${SLUG}"
mkdir -p "$DEST_DIR"
DEST="${DEST_DIR}/${PRODUCT_NAME}.app"
rm -rf "$DEST"
cp -R "$BUNDLE_SRC" "$DEST"

echo "==> QA build installed at: ${DEST}"
echo "==> This does NOT touch /Applications/Kolloq.app (different bundle id)."
echo "==> Open with: open \"${DEST}\""
