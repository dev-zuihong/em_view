use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use encoding_rs::{GBK, UTF_16BE, UTF_16LE, WINDOWS_1252};
use goblin::elf::program_header::PT_LOAD;
use goblin::elf::section_header::{SHF_ALLOC, SHF_EXECINSTR, SHF_WRITE, SHT_NOBITS};
use goblin::elf::sym::{
    STB_GLOBAL, STB_LOCAL, STB_WEAK, STT_FILE, STT_FUNC, STT_OBJECT, STT_SECTION,
};
use goblin::Object;
use regex::Regex;
use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ParseError {
    #[error("文件路径为空。")]
    EmptyPath,
    #[error("文件不存在：{0}")]
    MissingFile(String),
    #[error("暂不支持该文件类型。当前支持：.map, .axf")]
    UnsupportedExtension,
    #[error("无法读取文件：{0}")]
    Read(String),
    #[error("无法读取 MAP 文件编码。")]
    Encoding,
    #[error("AXF/ELF 解析失败：{0}")]
    Axf(String),
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ArtifactKind {
    Map,
    Axf,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisResult {
    pub kind: ArtifactKind,
    pub source_format: String,
    pub capabilities: Capabilities,
    pub summary: Summary,
    pub regions: Vec<Region>,
    pub objects: Vec<ObjectRow>,
    pub symbols_by_object: BTreeMap<String, Vec<SymbolRow>>,
    pub symbols: Vec<SymbolEntry>,
    pub sections: Vec<SectionEntry>,
    pub firmware_summary: FirmwareSummary,
    pub removed_unused: RemovedUnused,
    pub library: LibraryInfo,
    pub dependencies: DependencyGraph,
    pub member_to_library: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub overview: bool,
    pub symbols: bool,
    pub dead_code: bool,
    pub library: bool,
    pub dependencies: bool,
}

impl Capabilities {
    fn map(has_dependencies: bool) -> Self {
        Self {
            overview: true,
            symbols: true,
            dead_code: true,
            library: true,
            dependencies: has_dependencies,
        }
    }

    fn axf() -> Self {
        Self {
            overview: true,
            symbols: true,
            dead_code: false,
            library: true,
            dependencies: false,
        }
    }
}

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub total_ro: Option<i64>,
    pub total_rw: Option<i64>,
    pub total_rom: Option<i64>,
    pub grand_totals: Option<Totals>,
    pub removed_unused_sections: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Totals {
    pub code_inc_data: i64,
    pub inc_data: i64,
    pub ro: i64,
    pub rw: i64,
    pub zi: i64,
    pub debug: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Region {
    pub name: String,
    pub exec_base: String,
    pub load_base: String,
    pub size: i64,
    pub max: i64,
    pub usage: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectRow {
    pub name: String,
    pub code_inc_data: i64,
    pub inc_data: i64,
    pub ro: i64,
    pub rw: i64,
    pub zi: i64,
    pub debug: i64,
    pub code: i64,
    pub rom: i64,
    pub ram: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SymbolRow {
    pub exec_addr: String,
    pub load_addr: String,
    pub size: i64,
    pub symbol_type: String,
    pub attr: String,
    pub idx: i32,
    pub has_entry: bool,
    pub section: String,
    pub object: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SymbolEntry {
    pub name: String,
    pub address: i64,
    pub size: i64,
    pub symbol_type: String,
    pub binding: String,
    pub section: String,
    pub object: String,
    pub section_percent: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionEntry {
    pub name: String,
    pub address: i64,
    pub size: i64,
    pub flags: String,
    pub align: i64,
    pub source: String,
}

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FirmwareSummary {
    pub text: Option<i64>,
    pub data: Option<i64>,
    pub bss: Option<i64>,
    pub flash: Option<i64>,
    pub ram: Option<i64>,
    pub entry: Option<i64>,
    pub initial_sp: Option<i64>,
    pub reset_handler: Option<i64>,
}

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemovedUnused {
    pub total: i64,
    pub by_object: BTreeMap<String, RemovedObject>,
    pub object_names: Vec<String>,
}

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemovedObject {
    pub total: i64,
    pub sections: Vec<RemovedSection>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemovedSection {
    pub object: String,
    pub section: String,
    pub size: i64,
}

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryInfo {
    pub members: Vec<LibraryMember>,
    pub by_library: BTreeMap<String, Totals>,
    pub object_totals: Option<Totals>,
    pub library_totals: Option<Totals>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryMember {
    pub name: String,
    pub code_inc_data: i64,
    pub inc_data: i64,
    pub ro: i64,
    pub rw: i64,
    pub zi: i64,
    pub debug: i64,
    pub code: i64,
    pub rom: i64,
    pub ram: i64,
}

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyGraph {
    pub edges: Vec<DependencyEdge>,
    pub by_module: BTreeMap<String, ModuleDependency>,
    pub module_names: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyEdge {
    pub source: String,
    pub target: String,
    pub count: i32,
    pub symbols: Vec<String>,
}

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleDependency {
    pub depends_on: BTreeMap<String, i32>,
    pub depended_by: BTreeMap<String, i32>,
}

#[derive(Debug, Default)]
struct Bucket {
    code: i64,
    ro: i64,
    rw: i64,
    zi: i64,
    debug: i64,
}

impl Bucket {
    fn add(&mut self, class: SectionClass, size: i64) {
        match class {
            SectionClass::Code => self.code += size,
            SectionClass::Ro => self.ro += size,
            SectionClass::Rw => self.rw += size,
            SectionClass::Zi => self.zi += size,
            SectionClass::Debug => self.debug += size,
            SectionClass::Ignore => {}
        }
    }

    fn object_row(&self, name: String) -> ObjectRow {
        ObjectRow {
            name,
            code_inc_data: self.code,
            inc_data: 0,
            ro: self.ro,
            rw: self.rw,
            zi: self.zi,
            debug: self.debug,
            code: self.code,
            rom: self.code + self.ro + self.rw,
            ram: self.rw + self.zi,
        }
    }

    fn totals(&self) -> Totals {
        Totals {
            code_inc_data: self.code,
            inc_data: 0,
            ro: self.ro,
            rw: self.rw,
            zi: self.zi,
            debug: self.debug,
        }
    }
}

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
enum SectionClass {
    Code,
    Ro,
    Rw,
    Zi,
    Debug,
    Ignore,
}

pub fn analyze_path(path: &Path) -> Result<AnalysisResult, ParseError> {
    if path.as_os_str().is_empty() {
        return Err(ParseError::EmptyPath);
    }

    if !path.exists() {
        return Err(ParseError::MissingFile(path.display().to_string()));
    }

    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
    {
        Some(ext) if ext == "map" => parse_map_file(path),
        Some(ext) if ext == "axf" || ext == "elf" => parse_axf_file(path),
        _ => Err(ParseError::UnsupportedExtension),
    }
}

fn parse_map_file(path: &Path) -> Result<AnalysisResult, ParseError> {
    let data = fs::read(path).map_err(|error| ParseError::Read(error.to_string()))?;
    let text = decode_map_text(&data)?;
    Ok(parse_map_text(&text))
}

fn decode_map_text(data: &[u8]) -> Result<String, ParseError> {
    if data.starts_with(&[0xff, 0xfe]) {
        let (text, _, had_errors) = UTF_16LE.decode(&data[2..]);
        return (!had_errors)
            .then(|| text.into_owned())
            .ok_or(ParseError::Encoding);
    }

    if data.starts_with(&[0xfe, 0xff]) {
        let (text, _, had_errors) = UTF_16BE.decode(&data[2..]);
        return (!had_errors)
            .then(|| text.into_owned())
            .ok_or(ParseError::Encoding);
    }

    if let Ok(text) = String::from_utf8(data.to_vec()) {
        return Ok(text.trim_start_matches('\u{feff}').to_string());
    }

    for encoding in [GBK, WINDOWS_1252] {
        let (text, _, had_errors) = encoding.decode(data);
        if !had_errors {
            return Ok(text.into_owned());
        }
    }

    Err(ParseError::Encoding)
}

pub(crate) fn parse_map_text(text: &str) -> AnalysisResult {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let lines: Vec<&str> = normalized.split('\n').collect();
    if looks_like_gnu_ld_map(&lines) {
        parse_gnu_map_lines(&lines)
    } else {
        parse_keil_map_lines(&lines)
    }
}

fn looks_like_gnu_ld_map(lines: &[&str]) -> bool {
    let mut memory = false;
    let mut linker = false;
    let mut archive = false;
    let mut discarded = false;

    for line in lines {
        let stripped = line.trim();
        if stripped == "Memory Configuration" {
            memory = true;
        } else if stripped == "Linker script and memory map" {
            linker = true;
        } else if stripped.starts_with("Archive member included") {
            archive = true;
        } else if stripped == "Discarded input sections" {
            discarded = true;
        }

        if memory && linker {
            return true;
        }

        if archive && discarded && linker {
            return true;
        }
    }

    false
}

fn parse_keil_map_lines(lines: &[&str]) -> AnalysisResult {
    let mut summary = Summary::default();
    let mut regions = Vec::new();
    let mut objects = Vec::new();
    let mut symbols_by_object: BTreeMap<String, Vec<SymbolRow>> = BTreeMap::new();
    let mut member_to_library = BTreeMap::new();

    let re_total_ro = Regex::new(r"(?i)Total\s+RO\s+Size\s+\(Code \+ RO Data\)\s+(\d+)").unwrap();
    let re_total_rw =
        Regex::new(r"(?i)Total\s+RW\s+Size\s+\(RW Data \+ ZI Data\)\s+(\d+)").unwrap();
    let re_total_rom =
        Regex::new(r"(?i)Total\s+ROM Size\s+\(Code \+ RO Data \+ RW Data\)\s+(\d+)").unwrap();
    let re_unused =
        Regex::new(r"(?i)unused section\(s\)\s+\(total\s+(\d+)\s+bytes\)\s+removed").unwrap();
    let re_region = Regex::new(r"(?i)Execution Region\s+([^\s]+)\s+\(Exec base:\s*(0x[0-9a-f]+),\s*Load base:\s*(0x[0-9a-f]+),\s*Size:\s*(0x[0-9a-f]+),\s*Max:\s*(0x[0-9a-f]+)").unwrap();
    let re_totals =
        Regex::new(r"^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+Grand Totals\s*$")
            .unwrap();

    for line in lines {
        if let Some(caps) = re_total_ro.captures(line) {
            summary.total_ro = Some(parse_i64(&caps[1]));
        }
        if let Some(caps) = re_total_rw.captures(line) {
            summary.total_rw = Some(parse_i64(&caps[1]));
        }
        if let Some(caps) = re_total_rom.captures(line) {
            summary.total_rom = Some(parse_i64(&caps[1]));
        }
        if let Some(caps) = re_unused.captures(line) {
            summary.removed_unused_sections = Some(parse_i64(&caps[1]));
        }
        if let Some(caps) = re_region.captures(line) {
            let size = parse_hex_i64(&caps[4]);
            let max = parse_hex_i64(&caps[5]);
            regions.push(Region {
                name: caps[1].to_string(),
                exec_base: caps[2].to_string(),
                load_base: caps[3].to_string(),
                size,
                max,
                usage: percent(size, max),
            });
        }
        if let Some(caps) = re_totals.captures(line) {
            summary.grand_totals = Some(totals_from_caps(&caps));
        }
    }

    let re_exec_region = Regex::new(r"(?i)^    Execution Region\s+").unwrap();
    let re_symbol_header = Regex::new(r"(?i)Exec Addr\s+Load Addr\s+Size\s+Type\s+Attr").unwrap();
    let re_pad =
        Regex::new(r"(?i)^\s+(0x[0-9a-f]+)\s+(0x[0-9a-f]+)\s+(0x[0-9a-f]+)\s+PAD\s*$").unwrap();
    let re_symbol = Regex::new(r"(?i)^\s+(0x[0-9a-f]+)\s+(0x[0-9a-f]+|COMPRESSED)\s+(0x[0-9a-f]+)\s+(Code|Data)\s+(RO|RW)\s+(\d+)\s+(.+)$").unwrap();
    let re_library_ref = Regex::new(r"(?i)^([a-z_][\w.-]*\.(?:l|lib|a))\((.+)\)$").unwrap();
    let mut in_exec_region = false;
    let mut in_symbol_table = false;

    for line in lines {
        if re_exec_region.is_match(line) {
            in_exec_region = true;
            in_symbol_table = false;
            continue;
        }
        if in_exec_region && re_symbol_header.is_match(line) {
            in_symbol_table = true;
            continue;
        }
        if !in_symbol_table {
            continue;
        }
        if let Some(caps) = re_pad.captures(line) {
            add_symbol(
                &mut symbols_by_object,
                "__PAD__",
                SymbolRow {
                    exec_addr: caps[1].to_string(),
                    load_addr: caps[2].to_string(),
                    size: parse_hex_i64(&caps[3]),
                    symbol_type: "PAD".to_string(),
                    attr: String::new(),
                    idx: 0,
                    has_entry: false,
                    section: "PAD".to_string(),
                    object: String::new(),
                },
            );
            continue;
        }
        let Some(caps) = re_symbol.captures(line) else {
            continue;
        };
        let rest = caps[7].trim();
        let has_entry = rest.starts_with('*');
        let normalized_rest = rest.trim_start_matches('*').trim();
        let parts: Vec<&str> = Regex::new(r"\s{2,}")
            .unwrap()
            .split(normalized_rest)
            .collect();
        if parts.len() < 2 {
            continue;
        }
        let section = parts[0].trim();
        let object_reference = parts[parts.len() - 1].trim();
        let mut object_name = object_reference.to_string();
        if let Some(lib_caps) = re_library_ref.captures(&object_name) {
            member_to_library.insert(lib_caps[2].to_string(), lib_caps[1].to_string());
            object_name = lib_caps[2].to_string();
        }
        add_symbol(
            &mut symbols_by_object,
            &object_name,
            SymbolRow {
                exec_addr: caps[1].to_string(),
                load_addr: caps[2].to_string(),
                size: parse_hex_i64(&caps[3]),
                symbol_type: caps[4].to_string(),
                attr: caps[5].to_string(),
                idx: parse_i32(&caps[6]),
                has_entry,
                section: section.to_string(),
                object: object_reference.to_string(),
            },
        );
    }

    let re_object_header = Regex::new(r"(?i)Object Name\s*$").unwrap();
    let re_object_columns = Regex::new(r"(?i)Code \(inc\. data\)").unwrap();
    let re_object_totals = Regex::new(r"(?i)Object Totals").unwrap();
    let re_separator = Regex::new(r"^\s*-{10,}\s*$").unwrap();
    let re_sized_row =
        Regex::new(r"^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$").unwrap();
    let mut in_object_table = false;

    for line in lines {
        if re_object_header.is_match(line) && re_object_columns.is_match(line) {
            in_object_table = true;
            continue;
        }
        if in_object_table && re_separator.is_match(line) {
            continue;
        }
        if in_object_table && re_object_totals.is_match(line) {
            in_object_table = false;
            continue;
        }
        if !in_object_table {
            continue;
        }
        let Some(caps) = re_sized_row.captures(line) else {
            continue;
        };
        let name = caps[7].trim();
        if name.is_empty() || name.starts_with('(') {
            continue;
        }
        objects.push(object_row_from_caps(&caps));
    }

    objects.sort_by(|a, b| {
        b.rom
            .cmp(&a.rom)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    let re_removed = Regex::new(r"(?i)Removing\s+(\S+?)\(([^)]+)\),\s*\((\d+)\s+bytes\)").unwrap();
    let removed_sections: Vec<RemovedSection> = lines
        .iter()
        .filter_map(|line| {
            let caps = re_removed.captures(line)?;
            Some(RemovedSection {
                object: caps[1].to_string(),
                section: caps[2].to_string(),
                size: parse_i64(&caps[3]),
            })
        })
        .collect();
    let removed_unused = build_removed_unused(removed_sections);

    let library = parse_keil_library(lines, &re_sized_row);
    let dependencies = parse_keil_dependencies(lines);
    let has_dependencies = !dependencies.module_names.is_empty();
    let mut symbols = flat_symbols_from_symbol_rows(&symbols_by_object);
    let sections = map_sections_from_regions_and_symbols(&regions, &symbols);
    apply_section_percent(&mut symbols, &sections);
    let firmware_summary = firmware_summary_from_summary(&summary);

    AnalysisResult {
        kind: ArtifactKind::Map,
        source_format: "MAP".to_string(),
        capabilities: Capabilities::map(has_dependencies),
        summary,
        regions,
        objects,
        symbols_by_object,
        symbols,
        sections,
        firmware_summary,
        removed_unused,
        library,
        dependencies,
        member_to_library,
    }
}

fn parse_keil_library(lines: &[&str], re_sized_row: &Regex) -> LibraryInfo {
    let re_library_member_header = Regex::new(r"(?i)Library Member Name\s*$").unwrap();
    let re_library_name_header = Regex::new(r"(?i)Library Name\s*$").unwrap();
    let re_object_totals = Regex::new(r"(?i)Object Totals").unwrap();
    let re_library_totals = Regex::new(r"(?i)Library Totals").unwrap();
    let re_grand_totals = Regex::new(r"(?i)Grand Totals|ELF Image Totals|ROM Totals").unwrap();
    let re_columns = Regex::new(r"(?i)Code \(inc\. data\)").unwrap();
    let re_separator = Regex::new(r"^\s*-{10,}\s*$").unwrap();

    let mut members = Vec::new();
    let mut in_library_member = false;
    for line in lines {
        if re_library_member_header.is_match(line) && re_columns.is_match(line) {
            in_library_member = true;
            continue;
        }
        if re_library_name_header.is_match(line) && re_columns.is_match(line) {
            in_library_member = false;
            continue;
        }
        if !in_library_member
            || re_separator.is_match(line)
            || re_library_totals.is_match(line)
            || re_object_totals.is_match(line)
        {
            continue;
        }
        let Some(caps) = re_sized_row.captures(line) else {
            continue;
        };
        let name = caps[7].trim();
        if !name.is_empty() && !name.starts_with('(') {
            members.push(library_member_from_caps(&caps));
        }
    }

    let mut object_totals = None;
    let mut library_totals = None;
    let re_object_totals_line =
        Regex::new(r"(?i)^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+Object Totals\s*$")
            .unwrap();
    let re_library_totals_line =
        Regex::new(r"(?i)^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+Library Totals\s*$")
            .unwrap();
    for line in lines {
        if let Some(caps) = re_object_totals_line.captures(line) {
            object_totals = Some(totals_from_caps(&caps));
        }
        if let Some(caps) = re_library_totals_line.captures(line) {
            library_totals = Some(totals_from_caps(&caps));
        }
    }

    let mut by_library = BTreeMap::new();
    let mut in_library_name = false;
    for line in lines {
        if re_library_name_header.is_match(line) && re_columns.is_match(line) {
            in_library_name = true;
            continue;
        }
        if !in_library_name {
            continue;
        }
        if re_separator.is_match(line) || re_library_totals.is_match(line) {
            continue;
        }
        if re_grand_totals.is_match(line) {
            in_library_name = false;
            continue;
        }
        let Some(caps) = re_sized_row.captures(line) else {
            continue;
        };
        let name = caps[7].trim();
        if !name.is_empty() && name != "Library Totals" && !name.starts_with('(') {
            by_library.insert(name.to_string(), totals_from_caps(&caps));
        }
    }

    members.sort_by(|a, b| {
        b.rom
            .cmp(&a.rom)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    LibraryInfo {
        members,
        by_library,
        object_totals,
        library_totals,
    }
}

fn parse_keil_dependencies(lines: &[&str]) -> DependencyGraph {
    let re_start = Regex::new(r"(?i)^Section Cross References\s*$").unwrap();
    let re_end = Regex::new(r"^={5,}").unwrap();
    let re_ref =
        Regex::new(r"(?i)\s+(\S+\.o)\s*\([^)]*\)\s+refers to\s+(\S+\.o)\s*\([^)]*\)\s+for\s+(\S+)")
            .unwrap();
    let mut in_cross_reference = false;
    let mut edges: BTreeMap<String, DependencyEdge> = BTreeMap::new();

    for line in lines {
        if re_start.is_match(line.trim()) {
            in_cross_reference = true;
            continue;
        }
        if in_cross_reference && re_end.is_match(line.trim()) {
            in_cross_reference = false;
            continue;
        }
        if !in_cross_reference {
            continue;
        }
        let Some(caps) = re_ref.captures(line) else {
            continue;
        };
        let source = caps[1].to_string();
        let target = caps[2].to_string();
        if source == target {
            continue;
        }
        let key = format!("{source}->{target}");
        let edge = edges.entry(key).or_insert_with(|| DependencyEdge {
            source,
            target,
            count: 0,
            symbols: Vec::new(),
        });
        edge.count += 1;
        edge.symbols.push(caps[3].to_string());
    }

    dependency_graph_from_edges(edges.into_values().collect())
}

#[derive(Debug, Clone)]
struct GnuMemoryRegion {
    name: String,
    origin: i64,
    length: i64,
}

#[derive(Debug, Clone)]
struct GnuOutputSection {
    name: String,
    address: i64,
    size: i64,
    load_address: Option<i64>,
}

#[derive(Debug, Clone)]
struct GnuInputEntry {
    section: String,
    address: i64,
    size: i64,
    object_reference: String,
}

fn parse_gnu_map_lines(lines: &[&str]) -> AnalysisResult {
    let memory_regions = parse_gnu_memory_regions(lines);
    let mut member_to_library = parse_archive_member_relations(lines);
    let removed_unused = parse_gnu_discarded_sections(lines, &mut member_to_library);
    let (objects, symbols_by_object, regions, library) =
        parse_gnu_linker_map(lines, &memory_regions, &mut member_to_library);
    let total_code: i64 = objects.iter().map(|row| row.code).sum();
    let total_ro_data: i64 = objects.iter().map(|row| row.ro).sum();
    let total_rw_data: i64 = objects.iter().map(|row| row.rw).sum();
    let total_zi_data: i64 = objects.iter().map(|row| row.zi).sum();
    let summary = Summary {
        total_ro: Some(total_code + total_ro_data),
        total_rw: Some(total_rw_data + total_zi_data),
        total_rom: Some(total_code + total_ro_data + total_rw_data),
        grand_totals: Some(
            Bucket {
                code: total_code,
                ro: total_ro_data,
                rw: total_rw_data,
                zi: total_zi_data,
                debug: 0,
            }
            .totals(),
        ),
        removed_unused_sections: Some(removed_unused.total),
    };
    let mut symbols = flat_symbols_from_symbol_rows(&symbols_by_object);
    let sections = map_sections_from_regions_and_symbols(&regions, &symbols);
    apply_section_percent(&mut symbols, &sections);
    let firmware_summary = firmware_summary_from_summary(&summary);

    AnalysisResult {
        kind: ArtifactKind::Map,
        source_format: "MAP".to_string(),
        capabilities: Capabilities::map(false),
        summary,
        regions,
        objects,
        symbols_by_object,
        symbols,
        sections,
        firmware_summary,
        removed_unused,
        library,
        dependencies: DependencyGraph::default(),
        member_to_library,
    }
}

fn parse_gnu_memory_regions(lines: &[&str]) -> Vec<GnuMemoryRegion> {
    let re = Regex::new(r"^(\S+)\s+(0x[0-9a-fA-F]+)\s+(0x[0-9a-fA-F]+)(?:\s+(\S+))?\s*$").unwrap();
    let mut regions = Vec::new();
    let mut in_memory = false;
    for line in lines {
        let stripped = line.trim();
        if stripped == "Memory Configuration" {
            in_memory = true;
            continue;
        }
        if !in_memory {
            continue;
        }
        if stripped == "Linker script and memory map" {
            break;
        }
        if stripped.is_empty() || stripped.starts_with("Name ") {
            continue;
        }
        let Some(caps) = re.captures(stripped) else {
            continue;
        };
        let name = caps[1].to_string();
        let origin = parse_hex_i64(&caps[2]);
        let length = parse_hex_i64(&caps[3]);
        if name.starts_with('*') || length <= 0 || name.eq_ignore_ascii_case("UNPLACED_SECTIONS") {
            continue;
        }
        regions.push(GnuMemoryRegion {
            name,
            origin,
            length,
        });
    }
    regions
}

fn parse_archive_member_relations(lines: &[&str]) -> BTreeMap<String, String> {
    let mut member_to_library = BTreeMap::new();
    for line in lines {
        let stripped = line.trim();
        if stripped == "Discarded input sections" {
            break;
        }
        if let Some((library, member)) = archive_parts(stripped) {
            member_to_library.entry(member).or_insert(library);
        }
    }
    member_to_library
}

fn parse_gnu_discarded_sections(
    lines: &[&str],
    member_to_library: &mut BTreeMap<String, String>,
) -> RemovedUnused {
    let mut sections = Vec::new();
    let mut in_discarded = false;
    let mut pending_section: Option<String> = None;
    for line in lines {
        let stripped = line.trim();
        if stripped == "Discarded input sections" {
            in_discarded = true;
            pending_section = None;
            continue;
        }
        if !in_discarded {
            continue;
        }
        if stripped == "Memory Configuration" || stripped == "Linker script and memory map" {
            break;
        }
        let (entry, next_pending) = parse_gnu_input_entry(line, pending_section.as_deref());
        pending_section = next_pending;
        let Some(entry) = entry else {
            continue;
        };
        if ignored_gnu_section(&entry.section, entry.size) {
            continue;
        }
        let object = object_name_from_ref(&entry.object_reference, member_to_library);
        sections.push(RemovedSection {
            object,
            section: entry.section,
            size: entry.size,
        });
    }
    build_removed_unused(sections)
}

fn parse_gnu_linker_map(
    lines: &[&str],
    memory_regions: &[GnuMemoryRegion],
    member_to_library: &mut BTreeMap<String, String>,
) -> (
    Vec<ObjectRow>,
    BTreeMap<String, Vec<SymbolRow>>,
    Vec<Region>,
    LibraryInfo,
) {
    let mut in_linker = false;
    let mut pending_output: Option<String> = None;
    let mut pending_input: Option<String> = None;
    let mut current_output: Option<GnuOutputSection> = None;
    let mut object_parts: BTreeMap<String, Bucket> = BTreeMap::new();
    let mut symbols_by_object: BTreeMap<String, Vec<SymbolRow>> = BTreeMap::new();
    let mut region_ranges: BTreeMap<String, Vec<(i64, i64)>> = BTreeMap::new();

    for line in lines {
        let stripped = line.trim();
        if stripped == "Linker script and memory map" {
            in_linker = true;
            continue;
        }
        if !in_linker {
            continue;
        }
        if stripped.is_empty() {
            continue;
        }
        if stripped.starts_with("LOAD ")
            || stripped.starts_with("START GROUP")
            || stripped.starts_with("END GROUP")
        {
            continue;
        }

        let (output, next_pending_output) =
            parse_gnu_output_section(line, pending_output.as_deref());
        pending_output = next_pending_output;
        if let Some(output) = output {
            if !ignored_gnu_section(&output.name, output.size) {
                add_region_range(
                    &mut region_ranges,
                    memory_regions,
                    output.address,
                    output.size,
                );
            }
            current_output = Some(output);
            pending_input = None;
            continue;
        }

        let (entry, next_pending_input) = parse_gnu_input_entry(line, pending_input.as_deref());
        pending_input = next_pending_input;
        let Some(entry) = entry else {
            continue;
        };
        if ignored_gnu_section(&entry.section, entry.size) {
            continue;
        }
        let Some(class) = classify_gnu_section(
            &entry.section,
            entry.address,
            current_output.as_ref(),
            memory_regions,
        ) else {
            continue;
        };
        if class == SectionClass::Ignore {
            continue;
        }
        let object = object_name_from_ref(&entry.object_reference, member_to_library);
        object_parts
            .entry(object.clone())
            .or_default()
            .add(class, entry.size);
        add_symbol(
            &mut symbols_by_object,
            &object,
            SymbolRow {
                exec_addr: format_hex(entry.address),
                load_addr: current_output
                    .as_ref()
                    .and_then(|output| output.load_address)
                    .map(format_hex)
                    .unwrap_or_else(|| format_hex(entry.address)),
                size: entry.size,
                symbol_type: if class == SectionClass::Code {
                    "Code"
                } else {
                    "Data"
                }
                .to_string(),
                attr: match class {
                    SectionClass::Rw => "RW",
                    SectionClass::Zi => "ZI",
                    _ => "RO",
                }
                .to_string(),
                idx: 0,
                has_entry: false,
                section: entry.section,
                object: entry.object_reference,
            },
        );
    }

    let mut objects: Vec<ObjectRow> = object_parts
        .iter()
        .map(|(name, bucket)| bucket.object_row(name.clone()))
        .collect();
    objects.sort_by(|a, b| {
        b.rom
            .cmp(&a.rom)
            .then_with(|| b.ram.cmp(&a.ram))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    let regions: Vec<Region> = memory_regions
        .iter()
        .map(|region| {
            let used = region_ranges
                .get(&region.name)
                .map(|ranges| union_size(ranges))
                .unwrap_or(0);
            Region {
                name: region.name.clone(),
                exec_base: format_hex(region.origin),
                load_base: format_hex(region.origin),
                size: used,
                max: region.length,
                usage: percent(used, region.length),
            }
        })
        .collect();

    let library = build_gnu_library(&object_parts, member_to_library);
    (objects, symbols_by_object, regions, library)
}

fn build_gnu_library(
    object_parts: &BTreeMap<String, Bucket>,
    member_to_library: &BTreeMap<String, String>,
) -> LibraryInfo {
    let mut members = Vec::new();
    let mut by_library_bucket: BTreeMap<String, Bucket> = BTreeMap::new();
    let mut object_totals = Bucket::default();
    let mut library_totals = Bucket::default();

    for (name, bucket) in object_parts {
        if let Some(library_name) = member_to_library.get(name) {
            members.push(library_member_from_bucket(name.clone(), bucket));
            let target = by_library_bucket.entry(library_name.clone()).or_default();
            add_bucket(target, bucket);
            add_bucket(&mut library_totals, bucket);
        } else {
            add_bucket(&mut object_totals, bucket);
        }
    }

    members.sort_by(|a, b| {
        b.rom
            .cmp(&a.rom)
            .then_with(|| b.ram.cmp(&a.ram))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    LibraryInfo {
        members,
        by_library: by_library_bucket
            .into_iter()
            .map(|(name, bucket)| (name, bucket.totals()))
            .collect(),
        object_totals: Some(object_totals.totals()),
        library_totals: Some(library_totals.totals()),
    }
}

fn parse_gnu_output_section(
    line: &str,
    pending: Option<&str>,
) -> (Option<GnuOutputSection>, Option<String>) {
    let one_line = Regex::new(r"^(?P<name>\.\S+)\s+(?P<addr>0x[0-9a-fA-F]+)\s+(?P<size>0x[0-9a-fA-F]+)(?:\s+load address (?P<load>0x[0-9a-fA-F]+))?.*$").unwrap();
    if let Some(caps) = one_line.captures(line) {
        return (
            Some(GnuOutputSection {
                name: caps["name"].to_string(),
                address: parse_hex_i64(&caps["addr"]),
                size: parse_hex_i64(&caps["size"]),
                load_address: caps.name("load").map(|value| parse_hex_i64(value.as_str())),
            }),
            None,
        );
    }

    if let Some(name) = pending {
        let detail = Regex::new(r"^\s+(?P<addr>0x[0-9a-fA-F]+)\s+(?P<size>0x[0-9a-fA-F]+)(?:\s+load address (?P<load>0x[0-9a-fA-F]+))?\s*$").unwrap();
        if let Some(caps) = detail.captures(line) {
            return (
                Some(GnuOutputSection {
                    name: name.to_string(),
                    address: parse_hex_i64(&caps["addr"]),
                    size: parse_hex_i64(&caps["size"]),
                    load_address: caps.name("load").map(|value| parse_hex_i64(value.as_str())),
                }),
                None,
            );
        }
    }

    let name_re = Regex::new(r"^(?P<name>\.\S+)\s*$").unwrap();
    if let Some(caps) = name_re.captures(line) {
        return (None, Some(caps["name"].to_string()));
    }
    (None, pending.map(str::to_string))
}

fn parse_gnu_input_entry(
    line: &str,
    pending_section: Option<&str>,
) -> (Option<GnuInputEntry>, Option<String>) {
    let one_line = Regex::new(r"^\s+(?P<section>(?:\.\S+|COMMON))\s+(?P<addr>0x[0-9a-fA-F]+)\s+(?P<size>0x[0-9a-fA-F]+)\s+(?P<object>.+?)\s*$").unwrap();
    if let Some(caps) = one_line.captures(line) {
        let object_reference = caps["object"].trim().to_string();
        if looks_like_object_ref(&object_reference) {
            return (
                Some(GnuInputEntry {
                    section: caps["section"].to_string(),
                    address: parse_hex_i64(&caps["addr"]),
                    size: parse_hex_i64(&caps["size"]),
                    object_reference,
                }),
                None,
            );
        }
    }

    if let Some(section) = pending_section {
        let detail = Regex::new(
            r"^\s+(?P<addr>0x[0-9a-fA-F]+)\s+(?P<size>0x[0-9a-fA-F]+)\s+(?P<object>.+?)\s*$",
        )
        .unwrap();
        if let Some(caps) = detail.captures(line) {
            let object_reference = caps["object"].trim().to_string();
            if looks_like_object_ref(&object_reference) {
                return (
                    Some(GnuInputEntry {
                        section: section.to_string(),
                        address: parse_hex_i64(&caps["addr"]),
                        size: parse_hex_i64(&caps["size"]),
                        object_reference,
                    }),
                    None,
                );
            }
            return (None, None);
        }
    }

    let section_re = Regex::new(r"^\s+(?P<section>(?:\.\S+|COMMON))\s*$").unwrap();
    if let Some(caps) = section_re.captures(line) {
        return (None, Some(caps["section"].to_string()));
    }
    (None, pending_section.map(str::to_string))
}

fn classify_gnu_section(
    section: &str,
    address: i64,
    output: Option<&GnuOutputSection>,
    regions: &[GnuMemoryRegion],
) -> Option<SectionClass> {
    let lower = section.to_ascii_lowercase();
    let output_name = output
        .map(|value| value.name.to_ascii_lowercase())
        .unwrap_or_default();
    let output_address = output.map(|value| value.address).unwrap_or(address);
    let output_load = output.and_then(|value| value.load_address);
    let output_region = region_name_for_address(output_address, regions);
    let address_region = region_name_for_address(address, regions);

    if lower == "common"
        || lower.starts_with(".bss")
        || lower.starts_with(".tbss")
        || lower.starts_with(".noinit")
        || lower.starts_with(".non_init")
    {
        return Some(SectionClass::Zi);
    }
    if lower.starts_with(".data")
        || lower.starts_with(".sdata")
        || lower.starts_with(".tdata")
        || output_name.starts_with(".data")
        || output_name.starts_with(".sdata")
        || output_name.starts_with(".tdata")
    {
        return Some(SectionClass::Rw);
    }
    if output_load.is_some() && (output_region == "RAM" || address_region == "RAM") {
        return Some(SectionClass::Rw);
    }
    if lower.starts_with(".text")
        || lower.starts_with(".init")
        || lower.starts_with(".fini")
        || lower.starts_with(".glue_")
        || lower.starts_with(".vfp11_veneer")
        || lower.starts_with(".v4_bx")
    {
        return Some(SectionClass::Code);
    }
    if lower.starts_with(".vectors")
        || output_name.starts_with(".text")
        || output_name.starts_with(".init")
        || output_name.starts_with(".vectors")
    {
        return Some(SectionClass::Code);
    }
    if lower.starts_with(".rodata")
        || lower.starts_with(".arm.exidx")
        || lower.starts_with(".arm.extab")
    {
        return Some(SectionClass::Ro);
    }
    if output_region == "FLASH" || address_region == "FLASH" {
        return Some(SectionClass::Ro);
    }
    if output_region == "RAM" || address_region == "RAM" {
        return Some(SectionClass::Zi);
    }
    None
}

fn parse_axf_file(path: &Path) -> Result<AnalysisResult, ParseError> {
    let data = fs::read(path).map_err(|error| ParseError::Read(error.to_string()))?;
    let object = Object::parse(&data).map_err(|error| ParseError::Axf(error.to_string()))?;
    let Object::Elf(elf) = object else {
        return Err(ParseError::Axf("文件不是 ELF/AXF 格式。".to_string()));
    };

    let mut object_parts: BTreeMap<String, Bucket> = BTreeMap::new();
    let mut symbols_by_object: BTreeMap<String, Vec<SymbolRow>> = BTreeMap::new();
    let mut regions_by_name: BTreeMap<String, (i64, i64, i64)> = BTreeMap::new();
    let mut sections = Vec::new();

    for section in &elf.section_headers {
        let name = elf
            .shdr_strtab
            .get_at(section.sh_name)
            .unwrap_or("")
            .to_string();
        let size = section.sh_size as i64;
        if size <= 0 {
            continue;
        }
        let class = classify_elf_section(&name, section.sh_flags, section.sh_type);
        if class == SectionClass::Ignore {
            continue;
        }
        object_parts
            .entry(name.clone())
            .or_default()
            .add(class, size);

        let addr = section.sh_addr as i64;
        let region_name = region_for_elf_section(&name, section.sh_flags);
        let entry = regions_by_name
            .entry(region_name)
            .or_insert((addr, addr, 0));
        if entry.2 == 0 {
            entry.0 = addr;
            entry.1 = addr;
        }
        entry.0 = entry.0.min(addr);
        entry.1 = entry.1.min(addr);
        entry.2 += size;

        if section.sh_flags & u64::from(SHF_ALLOC) != 0 {
            sections.push(SectionEntry {
                name,
                address: addr,
                size,
                flags: elf_section_flags(section.sh_flags, section.sh_type),
                align: section.sh_addralign as i64,
                source: "ELF".to_string(),
            });
        }
    }
    sections.sort_by(|a, b| a.address.cmp(&b.address).then_with(|| a.name.cmp(&b.name)));

    let mut section_names = Vec::new();
    for section in &elf.section_headers {
        section_names.push(
            elf.shdr_strtab
                .get_at(section.sh_name)
                .unwrap_or("")
                .to_string(),
        );
    }

    let mut symbols = Vec::new();
    for (idx, sym) in elf.syms.iter().enumerate() {
        let section = if sym.st_shndx < section_names.len() {
            section_names[sym.st_shndx].clone()
        } else {
            String::new()
        };
        let symbol_type = elf_symbol_type(sym.st_type()).to_string();
        let raw_name = elf.strtab.get_at(sym.st_name).unwrap_or("");
        let name = if raw_name.is_empty() && sym.st_type() == STT_SECTION {
            section.clone()
        } else {
            raw_name.to_string()
        };
        if name.is_empty() {
            continue;
        }

        symbols.push(SymbolEntry {
            name: name.clone(),
            address: sym.st_value as i64,
            size: sym.st_size as i64,
            symbol_type: symbol_type.clone(),
            binding: elf_symbol_binding(sym.st_bind()).to_string(),
            section: section.clone(),
            object: String::new(),
            section_percent: None,
        });

        if sym.st_size == 0 || section.is_empty() {
            continue;
        }
        let class = classify_symbol(&section, sym.st_type());
        if class == SectionClass::Ignore {
            continue;
        }
        let owner = section.clone();
        add_symbol(
            &mut symbols_by_object,
            &owner,
            SymbolRow {
                exec_addr: format_hex(sym.st_value as i64),
                load_addr: format_hex(sym.st_value as i64),
                size: sym.st_size as i64,
                symbol_type: if class == SectionClass::Code {
                    "Code"
                } else {
                    "Data"
                }
                .to_string(),
                attr: match class {
                    SectionClass::Rw => "RW",
                    SectionClass::Zi => "ZI",
                    _ => "RO",
                }
                .to_string(),
                idx: idx as i32,
                has_entry: false,
                section,
                object: name,
            },
        );
    }
    apply_section_percent(&mut symbols, &sections);

    let mut objects: Vec<ObjectRow> = object_parts
        .iter()
        .map(|(name, bucket)| bucket.object_row(name.clone()))
        .collect();
    objects.sort_by(|a, b| {
        b.rom
            .cmp(&a.rom)
            .then_with(|| b.ram.cmp(&a.ram))
            .then_with(|| a.name.cmp(&b.name))
    });

    let total_code: i64 = objects.iter().map(|row| row.code).sum();
    let total_ro: i64 = objects.iter().map(|row| row.ro).sum();
    let total_rw: i64 = objects.iter().map(|row| row.rw).sum();
    let total_zi: i64 = objects.iter().map(|row| row.zi).sum();
    let total_debug: i64 = objects.iter().map(|row| row.debug).sum();

    let regions = regions_by_name
        .into_iter()
        .map(|(name, (exec, load, size))| Region {
            name,
            exec_base: format_hex(exec),
            load_base: format_hex(load),
            size,
            max: size,
            usage: if size > 0 { 100.0 } else { 0.0 },
        })
        .collect();

    let mut library_members = Vec::new();
    let mut by_library_bucket: BTreeMap<String, Bucket> = BTreeMap::new();
    let mut object_totals = Bucket::default();
    let mut library_totals = Bucket::default();
    let mut member_to_library = BTreeMap::new();
    for (name, bucket) in &object_parts {
        if let Some((library, member)) = archive_parts(name) {
            member_to_library.insert(member.clone(), library.clone());
            library_members.push(library_member_from_bucket(member, bucket));
            add_bucket(by_library_bucket.entry(library).or_default(), bucket);
            add_bucket(&mut library_totals, bucket);
        } else {
            add_bucket(&mut object_totals, bucket);
        }
    }
    let firmware_summary = FirmwareSummary {
        text: Some(total_code + total_ro),
        data: Some(total_rw),
        bss: Some(total_zi),
        flash: Some(total_code + total_ro + total_rw),
        ram: Some(total_rw + total_zi),
        entry: Some(elf.entry as i64),
        initial_sp: initial_vector_word(&data, &elf, 0),
        reset_handler: initial_vector_word(&data, &elf, 4),
    };

    Ok(AnalysisResult {
        kind: ArtifactKind::Axf,
        source_format: "AXF".to_string(),
        capabilities: Capabilities::axf(),
        summary: Summary {
            total_ro: Some(total_code + total_ro),
            total_rw: Some(total_rw + total_zi),
            total_rom: Some(total_code + total_ro + total_rw),
            grand_totals: Some(Totals {
                code_inc_data: total_code,
                inc_data: 0,
                ro: total_ro,
                rw: total_rw,
                zi: total_zi,
                debug: total_debug,
            }),
            removed_unused_sections: None,
        },
        regions,
        objects,
        symbols_by_object,
        symbols,
        sections,
        firmware_summary,
        removed_unused: RemovedUnused::default(),
        library: LibraryInfo {
            members: library_members,
            by_library: by_library_bucket
                .into_iter()
                .map(|(name, bucket)| (name, bucket.totals()))
                .collect(),
            object_totals: Some(object_totals.totals()),
            library_totals: Some(library_totals.totals()),
        },
        dependencies: DependencyGraph::default(),
        member_to_library,
    })
}

fn classify_elf_section(name: &str, flags: u64, section_type: u32) -> SectionClass {
    let lower = name.to_ascii_lowercase();
    if lower.starts_with(".debug")
        || lower.starts_with(".comment")
        || lower.starts_with(".stab")
        || lower.starts_with(".line")
    {
        return SectionClass::Debug;
    }
    if lower.starts_with(".bss") || lower.starts_with(".noinit") || lower.starts_with(".tbss") {
        return SectionClass::Zi;
    }
    if lower.starts_with(".data") || lower.starts_with(".sdata") || lower.starts_with(".tdata") {
        return SectionClass::Rw;
    }
    if lower.starts_with(".text")
        || lower.starts_with(".init")
        || lower.starts_with(".fini")
        || lower.starts_with(".vectors")
    {
        return SectionClass::Code;
    }
    if lower.starts_with(".rodata")
        || lower.starts_with(".arm.exidx")
        || lower.starts_with(".arm.extab")
    {
        return SectionClass::Ro;
    }
    if flags & u64::from(SHF_EXECINSTR) != 0 {
        SectionClass::Code
    } else if section_type == SHT_NOBITS && flags & u64::from(SHF_ALLOC) != 0 {
        SectionClass::Zi
    } else if flags & u64::from(SHF_ALLOC) != 0 && flags & u64::from(SHF_WRITE) != 0 {
        SectionClass::Rw
    } else if flags & u64::from(SHF_ALLOC) != 0 {
        SectionClass::Ro
    } else {
        SectionClass::Ignore
    }
}

fn classify_symbol(section: &str, sym_type: u8) -> SectionClass {
    let class = classify_elf_section(section, 0, 0);
    if sym_type == STT_FUNC {
        SectionClass::Code
    } else {
        class
    }
}

fn region_for_elf_section(name: &str, flags: u64) -> String {
    let class = classify_elf_section(name, flags, 0);
    match class {
        SectionClass::Code | SectionClass::Ro => "ROM".to_string(),
        SectionClass::Rw | SectionClass::Zi => "RAM".to_string(),
        SectionClass::Debug => "DEBUG".to_string(),
        SectionClass::Ignore => "OTHER".to_string(),
    }
}

fn flat_symbols_from_symbol_rows(
    symbols_by_object: &BTreeMap<String, Vec<SymbolRow>>,
) -> Vec<SymbolEntry> {
    let mut symbols = Vec::new();
    for (owner, rows) in symbols_by_object {
        for row in rows {
            if row.symbol_type == "PAD" {
                continue;
            }
            let name = map_symbol_name(row);
            if name.is_empty() {
                continue;
            }
            symbols.push(SymbolEntry {
                name,
                address: parse_hex_i64(&row.exec_addr),
                size: row.size,
                symbol_type: map_symbol_type(&row.symbol_type, &row.section),
                binding: "UNKNOWN".to_string(),
                section: row.section.clone(),
                object: if owner == "__PAD__" {
                    String::new()
                } else {
                    owner.clone()
                },
                section_percent: None,
            });
        }
    }
    symbols.sort_by(|a, b| a.address.cmp(&b.address).then_with(|| a.name.cmp(&b.name)));
    symbols
}

fn map_symbol_name(row: &SymbolRow) -> String {
    let section = row.section.trim();
    if let Some(name) = section.strip_prefix(".text.") {
        return name.to_string();
    }
    if let Some(name) = section.strip_prefix(".data.") {
        return name.to_string();
    }
    if let Some(name) = section.strip_prefix(".bss.") {
        return name.to_string();
    }
    if let Some(name) = section.strip_prefix(".rodata.") {
        return name.to_string();
    }
    section.to_string()
}

fn map_symbol_type(symbol_type: &str, section: &str) -> String {
    let lower = section.to_ascii_lowercase();
    if symbol_type.eq_ignore_ascii_case("Code")
        || lower.starts_with(".text")
        || lower.starts_with(".init")
        || lower.starts_with(".fini")
    {
        "FUNC".to_string()
    } else if symbol_type.eq_ignore_ascii_case("Data")
        || lower.starts_with(".data")
        || lower.starts_with(".bss")
        || lower.starts_with(".rodata")
        || lower == "common"
    {
        "OBJECT".to_string()
    } else if lower.starts_with('.') {
        "SECTION".to_string()
    } else {
        "OTHER".to_string()
    }
}

fn map_sections_from_regions_and_symbols(
    regions: &[Region],
    symbols: &[SymbolEntry],
) -> Vec<SectionEntry> {
    let mut by_section: BTreeMap<String, (i64, i64)> = BTreeMap::new();
    for symbol in symbols {
        if symbol.size <= 0 {
            continue;
        }
        let entry = by_section
            .entry(symbol.section.clone())
            .or_insert((symbol.address, symbol.address));
        entry.0 = entry.0.min(symbol.address);
        entry.1 = entry.1.max(symbol.address + symbol.size);
    }

    let mut sections: Vec<SectionEntry> = by_section
        .into_iter()
        .map(|(name, (start, end))| SectionEntry {
            name,
            address: start,
            size: (end - start).max(0),
            flags: "MAP".to_string(),
            align: 0,
            source: "MAP symbol".to_string(),
        })
        .collect();

    if sections.is_empty() {
        sections = regions
            .iter()
            .map(|region| SectionEntry {
                name: region.name.clone(),
                address: parse_hex_i64(&region.exec_base),
                size: region.size,
                flags: "MAP".to_string(),
                align: 0,
                source: "MAP region".to_string(),
            })
            .collect();
    } else {
        for region in regions {
            if !sections.iter().any(|section| section.name == region.name) {
                sections.push(SectionEntry {
                    name: region.name.clone(),
                    address: parse_hex_i64(&region.exec_base),
                    size: region.size,
                    flags: "MAP".to_string(),
                    align: 0,
                    source: "MAP region".to_string(),
                });
            }
        }
    }
    sections.sort_by(|a, b| a.address.cmp(&b.address).then_with(|| a.name.cmp(&b.name)));
    sections
}

fn apply_section_percent(symbols: &mut [SymbolEntry], sections: &[SectionEntry]) {
    let section_sizes: BTreeMap<&str, i64> = sections
        .iter()
        .map(|section| (section.name.as_str(), section.size))
        .collect();
    for symbol in symbols {
        symbol.section_percent = section_sizes.get(symbol.section.as_str()).and_then(|size| {
            if *size > 0 && symbol.size >= 0 {
                Some(symbol.size as f64 / *size as f64 * 100.0)
            } else {
                None
            }
        });
    }
}

fn firmware_summary_from_summary(summary: &Summary) -> FirmwareSummary {
    let text = summary
        .grand_totals
        .as_ref()
        .map(|totals| totals.code_inc_data + totals.ro);
    let data = summary.grand_totals.as_ref().map(|totals| totals.rw);
    let bss = summary.grand_totals.as_ref().map(|totals| totals.zi);
    FirmwareSummary {
        text,
        data,
        bss,
        flash: summary.total_rom,
        ram: summary.total_rw,
        entry: None,
        initial_sp: None,
        reset_handler: None,
    }
}

fn elf_symbol_type(value: u8) -> &'static str {
    match value {
        STT_OBJECT => "OBJECT",
        STT_FUNC => "FUNC",
        STT_SECTION => "SECTION",
        STT_FILE => "FILE",
        _ => "OTHER",
    }
}

fn elf_symbol_binding(value: u8) -> &'static str {
    match value {
        STB_LOCAL => "LOCAL",
        STB_GLOBAL => "GLOBAL",
        STB_WEAK => "WEAK",
        _ => "UNKNOWN",
    }
}

fn elf_section_flags(flags: u64, section_type: u32) -> String {
    let mut parts = Vec::new();
    if flags & u64::from(SHF_ALLOC) != 0 {
        parts.push("ALLOC");
    }
    if flags & u64::from(SHF_EXECINSTR) != 0 {
        parts.push("EXEC");
    }
    if flags & u64::from(SHF_WRITE) != 0 {
        parts.push("WRITE");
    }
    if section_type == SHT_NOBITS {
        parts.push("NOBITS");
    }
    if parts.is_empty() {
        "NONE".to_string()
    } else {
        parts.join("|")
    }
}

fn initial_vector_word(data: &[u8], elf: &goblin::elf::Elf<'_>, offset: usize) -> Option<i64> {
    let segment = elf
        .program_headers
        .iter()
        .filter(|header| header.p_type == PT_LOAD && header.p_filesz >= 8)
        .min_by_key(|header| header.p_vaddr)?;
    let start = segment.p_offset as usize + offset;
    let end = start.checked_add(4)?;
    let bytes: [u8; 4] = data.get(start..end)?.try_into().ok()?;
    let value = if elf.little_endian {
        u32::from_le_bytes(bytes)
    } else {
        u32::from_be_bytes(bytes)
    };
    Some(i64::from(value))
}

fn ignored_gnu_section(section: &str, size: i64) -> bool {
    if size <= 0 {
        return true;
    }
    let lower = section.to_ascii_lowercase();
    lower == ".arm.attributes"
        || [
            ".comment",
            ".debug",
            ".stab",
            ".note",
            ".gnu.attributes",
            ".rel.",
            ".rela.",
        ]
        .iter()
        .any(|prefix| lower.starts_with(prefix))
}

fn add_region_range(
    region_ranges: &mut BTreeMap<String, Vec<(i64, i64)>>,
    regions: &[GnuMemoryRegion],
    start: i64,
    size: i64,
) {
    if size <= 0 {
        return;
    }
    let end = start + size;
    for region in regions {
        let clipped_start = start.max(region.origin);
        let clipped_end = end.min(region.origin + region.length);
        if clipped_start < clipped_end {
            region_ranges
                .entry(region.name.clone())
                .or_default()
                .push((clipped_start, clipped_end));
        }
    }
}

fn union_size(ranges: &[(i64, i64)]) -> i64 {
    let mut ordered = ranges.to_vec();
    ordered.sort_by_key(|value| (value.0, value.1));
    let mut merged: Vec<(i64, i64)> = Vec::new();
    for (start, end) in ordered {
        if merged.last().map(|last| start > last.1).unwrap_or(true) {
            merged.push((start, end));
        } else if let Some(last) = merged.last_mut() {
            last.1 = last.1.max(end);
        }
    }
    merged.iter().map(|(start, end)| end - start).sum()
}

fn region_name_for_address(address: i64, regions: &[GnuMemoryRegion]) -> String {
    for region in regions {
        if region.origin <= address && address < region.origin + region.length {
            return region.name.to_ascii_uppercase();
        }
    }
    String::new()
}

fn dependency_graph_from_edges(edges: Vec<DependencyEdge>) -> DependencyGraph {
    let mut by_module: BTreeMap<String, ModuleDependency> = BTreeMap::new();
    for edge in &edges {
        by_module
            .entry(edge.source.clone())
            .or_default()
            .depends_on
            .entry(edge.target.clone())
            .and_modify(|value| *value += edge.count)
            .or_insert(edge.count);
        by_module
            .entry(edge.target.clone())
            .or_default()
            .depended_by
            .entry(edge.source.clone())
            .and_modify(|value| *value += edge.count)
            .or_insert(edge.count);
    }
    let module_names = by_module.keys().cloned().collect();
    DependencyGraph {
        edges,
        by_module,
        module_names,
    }
}

fn build_removed_unused(sections: Vec<RemovedSection>) -> RemovedUnused {
    let mut by_object: BTreeMap<String, RemovedObject> = BTreeMap::new();
    let mut total = 0;
    for section in sections {
        total += section.size;
        let item = by_object.entry(section.object.clone()).or_default();
        item.total += section.size;
        item.sections.push(section);
    }
    let mut object_names: Vec<String> = by_object.keys().cloned().collect();
    object_names.sort_by(|a, b| {
        by_object[b]
            .total
            .cmp(&by_object[a].total)
            .then_with(|| a.to_lowercase().cmp(&b.to_lowercase()))
    });
    RemovedUnused {
        total,
        by_object,
        object_names,
    }
}

fn add_symbol(target: &mut BTreeMap<String, Vec<SymbolRow>>, object_name: &str, row: SymbolRow) {
    target.entry(object_name.to_string()).or_default().push(row);
}

fn object_row_from_caps(caps: &regex::Captures<'_>) -> ObjectRow {
    let code_inc_data = parse_i64(&caps[1]);
    let inc_data = parse_i64(&caps[2]);
    let ro = parse_i64(&caps[3]);
    let rw = parse_i64(&caps[4]);
    let zi = parse_i64(&caps[5]);
    let debug = parse_i64(&caps[6]);
    let name = caps[7].trim().to_string();
    let code = (code_inc_data - inc_data).max(0);
    ObjectRow {
        name,
        code_inc_data,
        inc_data,
        ro,
        rw,
        zi,
        debug,
        code,
        rom: code_inc_data + ro + rw,
        ram: rw + zi,
    }
}

fn library_member_from_caps(caps: &regex::Captures<'_>) -> LibraryMember {
    let row = object_row_from_caps(caps);
    LibraryMember {
        name: row.name,
        code_inc_data: row.code_inc_data,
        inc_data: row.inc_data,
        ro: row.ro,
        rw: row.rw,
        zi: row.zi,
        debug: row.debug,
        code: row.code,
        rom: row.rom,
        ram: row.ram,
    }
}

fn library_member_from_bucket(name: String, bucket: &Bucket) -> LibraryMember {
    let row = bucket.object_row(name);
    LibraryMember {
        name: row.name,
        code_inc_data: row.code_inc_data,
        inc_data: row.inc_data,
        ro: row.ro,
        rw: row.rw,
        zi: row.zi,
        debug: row.debug,
        code: row.code,
        rom: row.rom,
        ram: row.ram,
    }
}

fn totals_from_caps(caps: &regex::Captures<'_>) -> Totals {
    Totals {
        code_inc_data: parse_i64(&caps[1]),
        inc_data: parse_i64(&caps[2]),
        ro: parse_i64(&caps[3]),
        rw: parse_i64(&caps[4]),
        zi: parse_i64(&caps[5]),
        debug: parse_i64(&caps[6]),
    }
}

fn add_bucket(target: &mut Bucket, source: &Bucket) {
    target.code += source.code;
    target.ro += source.ro;
    target.rw += source.rw;
    target.zi += source.zi;
    target.debug += source.debug;
}

fn archive_parts(reference: &str) -> Option<(String, String)> {
    let re = Regex::new(r"(?i)(?P<library>.+?\.(?:a|lib|l))\((?P<member>[^()]+\.o)\)$").unwrap();
    let caps = re.captures(reference.trim())?;
    Some((basename(&caps["library"]), basename(&caps["member"])))
}

fn object_name_from_ref(
    reference: &str,
    member_to_library: &mut BTreeMap<String, String>,
) -> String {
    if let Some((library, member)) = archive_parts(reference) {
        member_to_library.entry(member.clone()).or_insert(library);
        member
    } else {
        basename(reference.trim())
    }
}

fn looks_like_object_ref(reference: &str) -> bool {
    if archive_parts(reference).is_some() {
        return true;
    }
    Regex::new(r"(?i)(?:^|[/\\])?[^/\\()]+\.o$")
        .unwrap()
        .is_match(reference.trim())
}

fn basename(reference: &str) -> String {
    reference
        .replace('\\', "/")
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or(reference)
        .to_string()
}

fn parse_i64(value: &str) -> i64 {
    value.parse::<i64>().unwrap_or(0)
}

fn parse_i32(value: &str) -> i32 {
    value.parse::<i32>().unwrap_or(0)
}

fn parse_hex_i64(value: &str) -> i64 {
    i64::from_str_radix(value.trim_start_matches("0x").trim_start_matches("0X"), 16).unwrap_or(0)
}

fn format_hex(value: i64) -> String {
    format!("0x{value:016x}")
}

fn percent(size: i64, max: i64) -> f64 {
    if max > 0 {
        size as f64 / max as f64 * 100.0
    } else {
        0.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_keil_summary_and_objects() {
        let text = r#"
    Execution Region ER_IROM1 (Exec base: 0x08000000, Load base: 0x08000000, Size: 0x00000010, Max: 0x00000100, ABSOLUTE)
Total RO Size (Code + RO Data)                20 (   0.02kB)
Total RW Size (RW Data + ZI Data)             12 (   0.01kB)
Total ROM Size (Code + RO Data + RW Data)     24 (   0.02kB)
    10          2          8          4          8          1    Grand Totals

    Code (inc. data)   RO Data    RW Data    ZI Data      Debug   Object Name
    -------------------------------------------------------------------------
    12          2          8          4          8          1    main.o
    12          0          0          0          0          0    Object Totals
"#;
        let result = parse_map_text(text);
        assert_eq!(result.kind, ArtifactKind::Map);
        assert_eq!(result.summary.total_rom, Some(24));
        assert_eq!(result.regions.len(), 1);
        assert_eq!(result.objects.len(), 1);
        assert_eq!(result.objects[0].name, "main.o");
        assert_eq!(result.objects[0].code, 10);
    }

    #[test]
    fn parses_removed_sections() {
        let text =
            "Removing main.o(.text.dead), (16 bytes)\nunused section(s) (total 16 bytes) removed";
        let result = parse_map_text(text);
        assert_eq!(result.removed_unused.total, 16);
        assert_eq!(result.removed_unused.object_names, vec!["main.o"]);
    }

    #[test]
    fn parses_gnu_memory_and_object() {
        let text = r#"
Memory Configuration

Name             Origin             Length             Attributes
FLASH            0x0000000008000000 0x0000000000010000 xr
RAM              0x0000000020000000 0x0000000000004000 xrw

Linker script and memory map
.text           0x0000000008000000       0x10
 .text.main     0x0000000008000000       0x10 build/main.o
.data           0x0000000020000000        0x4 load address 0x0000000008000010
 .data.value    0x0000000020000000        0x4 build/main.o
"#;
        let result = parse_map_text(text);
        assert_eq!(result.objects.len(), 1);
        assert_eq!(result.objects[0].name, "main.o");
        assert_eq!(result.objects[0].code, 16);
        assert_eq!(result.objects[0].rw, 4);
        assert_eq!(result.regions.len(), 2);
    }
}
