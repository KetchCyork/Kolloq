#!/usr/bin/env bash
# Deletes bundle output left over from a previous build in this worktree.
#
# .metadata_never_index (see ensure-target-unindexed.sh) stops Spotlight from
# indexing *new* files, but it does not retroactively purge a bundle .app
# that was already indexed before the marker existed. Spotlight only drops
# an index entry once the underlying file is gone, so every build/qa-build
# clears its own previous bundle output first. That way the stale
# ai.newvector.cowork(.qa.*) claimant left by the last build in this
# worktree can never survive into the next one — no manual `mdfind` sweep
# required. See NEW-164.
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf src-tauri/target/*/bundle
