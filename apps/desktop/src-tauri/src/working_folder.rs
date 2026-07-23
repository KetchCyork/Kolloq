use serde::Serialize;
use std::fs;

#[derive(Serialize)]
pub struct FolderEntry {
    name: String,
    kind: &'static str,
}

/// Lists the immediate (non-recursive) contents of a native working folder path, mirroring
/// `listFolderEntries` in `projectFolder.ts` for the browser's File System Access handle. Runs
/// as plain `std::fs` (not the fs plugin's scope-gated API) since the path came straight out of
/// the native directory-picker dialog the user just confirmed.
#[tauri::command]
pub fn list_working_folder_entries(path: String) -> Result<Vec<FolderEntry>, String> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(&path).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let is_dir = entry.file_type().map_err(|err| err.to_string())?.is_dir();
        entries.push(FolderEntry { name, kind: if is_dir { "directory" } else { "file" } });
    }
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process;

    #[test]
    fn lists_files_and_directories_in_a_folder() {
        let dir = std::env::temp_dir().join(format!("newvector-working-folder-test-{}", process::id()));
        fs::create_dir_all(dir.join("subdir")).unwrap();
        fs::write(dir.join("notes.txt"), "hello").unwrap();

        let mut names: Vec<(String, &'static str)> = list_working_folder_entries(dir.to_string_lossy().into_owned())
            .unwrap()
            .into_iter()
            .map(|entry| (entry.name, entry.kind))
            .collect();
        names.sort();

        fs::remove_dir_all(&dir).unwrap();

        assert_eq!(names, vec![("notes.txt".to_string(), "file"), ("subdir".to_string(), "directory")]);
    }

    #[test]
    fn surfaces_an_error_string_for_a_missing_path() {
        let missing = std::env::temp_dir().join(format!("newvector-working-folder-missing-{}", process::id()));
        assert!(list_working_folder_entries(missing.to_string_lossy().into_owned()).is_err());
    }
}
