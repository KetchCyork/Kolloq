# Preferences & keyboard shortcuts

Open **Preferences** from the sidebar or press `⌘,` (Mac) / `Ctrl+,` (Windows/Linux).

## Theme

Choose **Dark**, **Light**, or **System** (follows your OS setting). The preference is saved to `localStorage` and applied immediately via the `data-theme` attribute on `<html>`.

## Default provider & model

The provider and model set here are used when creating a new agent session before you've picked one from the model picker. These can be overridden per-session in Session Settings.

## Keyboard shortcuts

All shortcuts are rebindable. Click any shortcut badge to record a new binding — press the key combination you want, or Escape to cancel.

| Action            | Default (Mac)  | Default (Win/Linux) |
|-------------------|----------------|---------------------|
| New agent session | `⌘N`           | `Ctrl+N`            |
| Open Preferences  | `⌘,`           | `Ctrl+,`            |
| Focus composer    | `⌘/`           | `Ctrl+/`            |

Bindings are stored in `localStorage` under the `newvector-preferences` key.
