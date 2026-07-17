# Task Assignments — Open Work

Task tracking for this project has moved to Paperclip issues. This file is kept only
as a pointer — do not add task lists here; they will drift out of sync with the board.

**Plan of record:** [NEW-26](/NEW/issues/NEW-26) — "Create a plan to develop a harness
to replicate Claude cowork allowing use of any LLM." Consult that issue thread for the
authoritative phase breakdown, ownership, and acceptance criteria.

## Phase status (as of 2026-07-17)

| Phase | Scope | Status | Issue |
|-------|-------|--------|-------|
| 1 | pnpm monorepo scaffold, provider-agnostic agent core | Done, pushed (`977989f`) | NEW-26 |
| 2 | Browser app: multi-agent web UI, streaming, IndexedDB | Done, pushed (`fc8c594`) | NEW-26 |
| 3 | Desktop app: Tauri v2 shell, keychain, tray, auto-update, signed CI | Done, pushed (`f1e9bd7`) | NEW-26 |
| Consolidation | Bring Phase 1–3 onto `KetchCyork/Open-Work` `main`, verify clean-clone build | Done | NEW-33 |
| Next | Remaining build-out | Proceeds against this repo | NEW-31, NEW-32 |

For anything not covered above (new task assignments, QA sign-off, priority calls),
open or comment on the relevant Paperclip issue rather than editing this file.
