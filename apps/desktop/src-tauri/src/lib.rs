mod keychain;
mod menu;
mod oauth;
mod tray;

use tauri::{Emitter, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            keychain::set_credential,
            keychain::get_credential,
            keychain::delete_credential,
            oauth::oauth_token_request,
        ])
        .setup(|app| {
            let menu = menu::build(app.handle())?;
            app.set_menu(menu)?;
            tray::build(app)?;
            Ok(())
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "new-session" => {
                let _ = app.emit("menu://new-session", ());
            }
            "check-updates" => {
                let _ = app.emit("menu://check-updates", ());
            }
            _ => {}
        })
        .on_window_event(|window, event| {
            // Closing the window hides it to the tray instead of quitting the
            // process outright, matching the tray icon's purpose of keeping
            // background agent sessions alive between window sessions.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running the Open Work desktop app");
}
