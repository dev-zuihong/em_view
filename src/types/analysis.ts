export interface Capabilities {
  overview: boolean;
  symbols: boolean;
  deadCode: boolean;
  library: boolean;
  dependencies: boolean;
}

export interface AnalysisResult {
  kind: "Map" | "Axf";
  sourceFormat: string;
  capabilities: Capabilities;
  summary: Summary;
  regions: Region[];
  objects: ObjectRow[];
  symbolsByObject: Record<string, SymbolRow[]>;
  symbols: SymbolEntry[];
  sections: SectionEntry[];
  firmwareSummary: FirmwareSummary;
  removedUnused: RemovedUnused;
  library: LibraryInfo;
  dependencies: DependencyGraph;
  memberToLibrary: Record<string, string>;
  mapDetails: MapDetails;
}

export interface Summary {
  totalRo: number | null;
  totalRw: number | null;
  totalRom: number | null;
  grandTotals: Totals | null;
  removedUnusedSections: number | null;
}

export interface Totals {
  codeIncData: number;
  incData: number;
  ro: number;
  rw: number;
  zi: number;
  debug: number;
}

export interface Region {
  name: string;
  execBase: string;
  loadBase: string;
  attributes: string | null;
  size: number;
  max: number;
  usage: number;
}

export interface ObjectRow {
  name: string;
  codeIncData: number;
  incData: number;
  ro: number;
  rw: number;
  zi: number;
  debug: number;
  code: number;
  rom: number;
  ram: number;
}

export interface SymbolRow {
  execAddr: string;
  loadAddr: string;
  size: number;
  symbolType: string;
  attr: string;
  idx: number;
  hasEntry: boolean;
  section: string;
  object: string;
}

export interface MapDetails {
  symbols: MapSymbolDetail[];
  sections: MapSectionDetail[];
  crossReferences: MapCrossReference[];
}

export interface MapSymbolDetail {
  name: string;
  owner: string;
  execAddr: string;
  loadAddr: string;
  size: number;
  symbolType: string;
  attr: string;
  idx: number;
  hasEntry: boolean;
  section: string;
  object: string;
  library: string | null;
  source: string;
}

export interface MapSectionDetail {
  name: string;
  outputSection: string;
  address: string;
  loadAddress: string | null;
  size: number;
  class: string;
  attr: string;
  object: string;
  library: string | null;
  source: string;
}

export interface MapCrossReference {
  sourceObject: string;
  sourceSection: string;
  targetObject: string;
  targetSection: string;
  symbol: string;
}

export interface SymbolEntry {
  name: string;
  address: number;
  size: number;
  symbolType: string;
  binding: string;
  section: string;
  object: string;
  sectionPercent: number | null;
}

export interface SectionEntry {
  name: string;
  address: number;
  size: number;
  flags: string;
  align: number;
  source: string;
}

export interface FirmwareSummary {
  text: number | null;
  data: number | null;
  bss: number | null;
  flash: number | null;
  ram: number | null;
  entry: number | null;
  initialSp: number | null;
  resetHandler: number | null;
}

export interface RemovedUnused {
  total: number;
  byObject: Record<string, RemovedObject>;
  objectNames: string[];
}

export interface RemovedObject {
  total: number;
  sections: RemovedSection[];
}

export interface RemovedSection {
  object: string;
  section: string;
  size: number;
}

export interface LibraryInfo {
  members: LibraryMember[];
  byLibrary: Record<string, Totals>;
  objectTotals: Totals | null;
  libraryTotals: Totals | null;
}

export interface LibraryMember extends ObjectRow {}

export interface DependencyGraph {
  edges: DependencyEdge[];
  byModule: Record<string, ModuleDependency>;
  moduleNames: string[];
}

export interface DependencyEdge {
  source: string;
  target: string;
  count: number;
  symbols: string[];
}

export interface ModuleDependency {
  dependsOn: Record<string, number>;
  dependedBy: Record<string, number>;
}

export type PageKey = "open" | "overview" | "symbols" | "deadcode" | "library" | "dependency";

export type TreemapDimension =
  | "code"
  | "codeIncData"
  | "incData"
  | "ro"
  | "rw"
  | "zi"
  | "rom"
  | "ram"
  | "debug";
