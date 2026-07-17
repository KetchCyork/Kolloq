use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Runtime};

/// Builds the native OS menu bar: an app menu on macOS plus File/Edit/Window/Help,
/// using the platform's predefined items (About, Quit, Cut/Copy/Paste, ...) so
/// behavior matches the user's OS conventions instead of a hand-rolled one.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let app_name = "New Vector Cowork";

    let app_menu = Submenu::with_items(
        app,
        app_name,
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    let new_session = MenuItem::with_id(app, "new-session", "New Session", true, Some("CmdOrCtrl+N"))?;
    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[&new_session, &PredefinedMenuItem::close_window(app, None)?],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    let check_updates = MenuItem::with_id(app, "check-updates", "Check for Updates…", true, None::<&str>)?;
    let help_menu = Submenu::with_items(app, "Help", true, &[&check_updates])?;

    Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu, &window_menu, &help_menu])
}
