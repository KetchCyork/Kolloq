#!/usr/bin/env bash
# Keeps Rust build output out of Spotlight/LaunchServices.
#
# `mdfind "kMDItemCFBundleIdentifier == 'ai.newvector.cowork'"` will resolve
# to *any* indexed .app with that identifier, including build artifacts
# sitting inside a worktree's src-tauri/target/. Placing a
# `.metadata_never_index` marker in that directory tells Spotlight to skip
# indexing it entirely, so a worktree build can never shadow the canonical
# /Applications install. `cargo clean` deletes target/ (and the marker with
# it), so this runs before every dev/build/qa-build invocation to recreate
# it — self-healing rather than a one-time setup step.
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET_DIR="src-tauri/target"
mkdir -p "$TARGET_DIR"
touch "$TARGET_DIR/.metadata_never_index"
