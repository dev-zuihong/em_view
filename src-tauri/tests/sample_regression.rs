use std::path::Path;

use emview_tauri_lib::parser::analyze_path;

#[test]
fn parses_workspace_map_sample() {
    let path = Path::new("./STD_Mouse_Solution.map");
    if !path.exists() {
        eprintln!("sample map not found, skipping");
        return;
    }

    let result = analyze_path(path).expect("sample map should parse");
    assert_eq!(result.source_format, "MAP");
    assert!(!result.objects.is_empty());
    assert!(!result.regions.is_empty());
    assert!(!result.symbols.is_empty());
    assert!(!result.sections.is_empty());
    assert!(result.summary.total_rom.unwrap_or_default() > 0);
    assert!(result.firmware_summary.flash.unwrap_or_default() > 0);
    assert!(result.firmware_summary.ram.unwrap_or_default() > 0);
    assert!(result.firmware_summary.entry.is_none());
    assert!(result.firmware_summary.initial_sp.is_none());
    assert!(result.firmware_summary.reset_handler.is_none());
}

#[test]
fn parses_workspace_axf_sample() {
    let path = Path::new("./STD_Mouse_Solution.axf");
    if !path.exists() {
        eprintln!("sample axf not found, skipping");
        return;
    }

    let result = analyze_path(path).expect("sample axf should parse");
    assert_eq!(result.source_format, "AXF");
    assert!(result.capabilities.overview);
    assert!(!result.capabilities.dead_code);
    assert!(!result.objects.is_empty());
    assert!(!result.symbols.is_empty());
    assert!(!result.sections.is_empty());
    assert!(result.firmware_summary.flash.unwrap_or_default() > 0);
    assert!(result.firmware_summary.ram.unwrap_or_default() > 0);
    assert!(result.firmware_summary.entry.is_some());
    assert!(result.firmware_summary.initial_sp.is_some());
    assert!(result.firmware_summary.reset_handler.is_some());
}
