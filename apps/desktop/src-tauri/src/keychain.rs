use keyring::Entry;

/// Service namespace under which every credential is stored in the OS
/// keychain (macOS Keychain, Windows Credential Manager, Linux Secret
/// Service). Keeping one constant service name means an uninstall/reinstall
/// can enumerate and clean up everything Open Work ever stored.
const SERVICE: &str = "ai.newvector.cowork";

fn entry(key: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, key).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn set_credential(key: String, value: String) -> Result<(), String> {
    entry(&key)?.set_password(&value).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn get_credential(key: String) -> Result<Option<String>, String> {
    match entry(&key)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
pub fn delete_credential(key: String) -> Result<(), String> {
    match entry(&key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Exercises the real OS keychain (not a mock), proving credentials
    // round-trip through it instead of ever touching plaintext storage.
    #[test]
    fn round_trips_through_the_os_keychain() {
        let key = "test-session-newvector-cowork-desktop";
        delete_credential(key.to_string()).unwrap();

        assert_eq!(get_credential(key.to_string()).unwrap(), None);

        set_credential(key.to_string(), "sk-test-secret".to_string()).unwrap();
        assert_eq!(
            get_credential(key.to_string()).unwrap(),
            Some("sk-test-secret".to_string())
        );

        delete_credential(key.to_string()).unwrap();
        assert_eq!(get_credential(key.to_string()).unwrap(), None);
    }
}
