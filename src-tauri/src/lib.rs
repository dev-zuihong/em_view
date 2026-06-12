pub mod parser;

use std::fs;
use std::path::Path;

use parser::{analyze_path, AnalysisResult};
#[tauri::command]
fn analyze_file(path: String) -> Result<AnalysisResult, String> {
    analyze_path(Path::new(&path)).map_err(|error| error.to_string())
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    fs::write(path, contents).map_err(|error| error.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![analyze_file, write_text_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
