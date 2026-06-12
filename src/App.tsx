import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  BarChart3,
  ChevronDown,
  ChevronUp,
  Download,
  FileCode2,
  FolderOpen,
  ListTree,
  Network,
  PieChart,
  ShieldAlert,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { DataTable, type Column } from "./components/DataTable";
import { DependencyGraphView } from "./components/DependencyGraphView";
import { Modal } from "./components/Modal";
import { Treemap } from "./components/Treemap";
import { bytes, dimensionLabel, percent, shortName, totalsText, valueFor } from "./format";
import type {
  AnalysisResult,
  FirmwareSummary,
  DependencyEdge,
  LibraryMember,
  MapCrossReference,
  MapSectionDetail,
  MapSymbolDetail,
  ObjectRow,
  PageKey,
  Region,
  RemovedSection,
  SectionEntry,
  SymbolEntry,
  SymbolRow,
  TreemapDimension,
} from "./types/analysis";

type ModalState =
  | { kind: "symbols"; title: string; rows: SymbolEntry[] }
  | { kind: "removed"; title: string; rows: RemovedSection[] }
  | { kind: "dependency"; title: string; edge: DependencyEdge }
  | null;

type DependencyViewMode = "module" | "overview";

interface DependencyHistoryEntry {
  view: DependencyViewMode;
  module: string | null;
}

const pages: Array<{ key: PageKey; label: string; icon: typeof FolderOpen }> = [
  { key: "overview", label: "内存概览", icon: BarChart3 },
  { key: "symbols", label: "符号分析", icon: ListTree },
  { key: "deadcode", label: "死代码分析", icon: ShieldAlert },
  { key: "library", label: "库文件分析", icon: PieChart },
  { key: "dependency", label: "模块依赖", icon: Network },
];

const dimensions: TreemapDimension[] = ["code", "codeIncData", "incData", "ro", "rw", "zi", "rom", "ram", "debug"];
const symbolTabs = ["summary", "symbols", "map"] as const;

function App() {
  const [page, setPage] = useState<PageKey>("open");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [status, setStatus] = useState("打开或拖入 Keil MAP/AXF 文件开始分析。");
  const [statusVisible, setStatusVisible] = useState(true);
  const [busy, setBusy] = useState(false);
  const [objectView, setObjectView] = useState<"table" | "treemap">("treemap");
  const [treemapDimensions, setTreemapDimensions] = useState<TreemapDimension[]>(["code"]);
  const [symbolTab, setSymbolTab] = useState<(typeof symbolTabs)[number]>("summary");
  const [dependencySort, setDependencySort] = useState<"dependedBy" | "dependsOn">("dependedBy");
  const [dependencyView, setDependencyView] = useState<DependencyViewMode>("overview");
  const [selectedModule, setSelectedModule] = useState<string | null>(null);
  const [dependencyHistory, setDependencyHistory] = useState<DependencyHistoryEntry[]>([]);
  const [dependencyHistoryIndex, setDependencyHistoryIndex] = useState(-1);
  const [moduleFilter, setModuleFilter] = useState("");
  const [moduleListCollapsed, setModuleListCollapsed] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);

  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type !== "drop") {
        return;
      }
      const path = event.payload.paths.find((item) => /\.(map|axf|elf)$/i.test(item));
      if (path) {
        void loadFile(path);
      }
    });
    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, []);

  const summaryMetrics = useMemo(() => {
    if (!result) {
      return [];
    }
    return [
      ["只读总量 (RO)", bytes(result.summary.totalRo)],
      ["读写总量 (RW)", bytes(result.summary.totalRw)],
      ["ROM 总量", bytes(result.summary.totalRom)],
      ["已移除未使用代码", bytes(result.summary.removedUnusedSections)],
      ["对象文件数", result.objects.length.toLocaleString()],
      ["内存区域数", result.regions.length.toLocaleString()],
    ];
  }, [result]);

  const deadRows = useMemo(() => {
    if (!result) {
      return [];
    }
    const romByObject = new Map(result.objects.map((row) => [row.name, row.rom]));
    return result.removedUnused.objectNames
      .map((name) => {
        const removed = result.removedUnused.byObject[name];
        const rom = romByObject.get(name) ?? 0;
        const rate = removed.total + rom > 0 ? (removed.total / (removed.total + rom)) * 100 : 0;
        return { name, removed, rom, rate };
      })
      .sort((a, b) => b.removed.total - a.removed.total);
  }, [result]);

  const librarySlices = useMemo(() => {
    if (!result) {
      return [];
    }
    const userRom = romFromTotals(result.library.objectTotals);
    const entries = Object.entries(result.library.byLibrary)
      .map(([name, totals]) => ({ name, rom: romFromTotals(totals) }))
      .sort((a, b) => b.rom - a.rom);
    const total = userRom + entries.reduce((sum, entry) => sum + entry.rom, 0);
    return [{ name: "用户代码", rom: userRom, total }, ...entries.map((entry) => ({ ...entry, total }))];
  }, [result]);

  const modules = useMemo(() => {
    if (!result) {
      return [];
    }
    const rows = result.dependencies.moduleNames.map((name) => {
      const dependency = result.dependencies.byModule[name];
      return {
        name,
        dependsOnCount: dependency ? Object.keys(dependency.dependsOn).length : 0,
        dependedByCount: dependency ? Object.keys(dependency.dependedBy).length : 0,
      };
    });
    rows.sort((a, b) =>
      dependencySort === "dependsOn" ? b.dependsOnCount - a.dependsOnCount : b.dependedByCount - a.dependedByCount,
    );
    return rows;
  }, [result, dependencySort]);

  const filteredModules = useMemo(() => {
    const normalizedFilter = moduleFilter.trim().toLowerCase();
    if (!normalizedFilter) {
      return modules;
    }
    return modules.filter((row) => row.name.toLowerCase().includes(normalizedFilter));
  }, [modules, moduleFilter]);

  useEffect(() => {
    if (!selectedModule && modules.length > 0) {
      selectDependencyModule(modules[0].name, { replace: true });
    }
  }, [modules, selectedModule]);

  useEffect(() => {
    setStatusVisible(true);
    if (busy) {
      return;
    }
    const timer = window.setTimeout(() => setStatusVisible(false), 3600);
    return () => window.clearTimeout(timer);
  }, [status, busy]);

  async function chooseFile() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Keil MAP/AXF/ELF 文件", extensions: ["map", "axf", "elf"] }],
    });
    if (typeof selected === "string") {
      await loadFile(selected);
    }
  }

  async function loadFile(path: string) {
    setBusy(true);
    setStatus(`正在解析 ${shortName(path)}...`);
    try {
      const analysis = await invoke<AnalysisResult>("analyze_file", { path });
      setResult(analysis);
      setSelectedModule(null);
      setDependencyHistory([]);
      setDependencyHistoryIndex(-1);
      setDependencyView("overview");
      setObjectView("treemap");
      setPage("overview");
      setStatus(`解析完成：${analysis.objects.length.toLocaleString()} 个对象，${analysis.regions.length.toLocaleString()} 个区域。`);
    } catch (error) {
      setStatus(`解析失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function exportHtmlReport() {
    if (!result) {
      return;
    }
    const path = await save({
      defaultPath: `emview_report_${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}.html`,
      filters: [{ name: "HTML 报告", extensions: ["html"] }],
    });
    if (!path) {
      return;
    }
    try {
      await invoke("write_text_file", { path, contents: buildHtmlReport(result) });
      setStatus(`HTML 报告导出完成：${path}`);
    } catch (error) {
      setStatus(`导出失败：${String(error)}`);
    }
  }

  function toggleTreemapDimension(dimension: TreemapDimension) {
    setTreemapDimensions((current) => {
      if (current.includes(dimension)) {
        return current.length === 1 ? current : current.filter((item) => item !== dimension);
      }
      return [...current, dimension];
    });
  }

  function navigateDependency(entry: DependencyHistoryEntry, options: { replace?: boolean } = {}) {
    setSelectedModule(entry.module);
    setDependencyView(entry.view);
    setDependencyHistory((current) => {
      if (options.replace || dependencyHistoryIndex < 0) {
        setDependencyHistoryIndex(0);
        return [entry];
      }
      if (sameDependencyHistoryEntry(current[dependencyHistoryIndex], entry)) {
        return current;
      }
      const next = [...current.slice(0, dependencyHistoryIndex + 1), entry];
      setDependencyHistoryIndex(next.length - 1);
      return next;
    });
  }

  function changeDependencyView(view: DependencyViewMode) {
    navigateDependency({ view, module: selectedModule ?? modules[0]?.name ?? null });
  }

  function selectDependencyModule(name: string, options: { replace?: boolean } = {}) {
    navigateDependency({ view: dependencyView, module: name }, options);
  }

  function openDependencyModule(name: string) {
    navigateDependency({ view: "module", module: name });
  }

  function stepDependencyHistory(offset: -1 | 1) {
    const nextIndex = dependencyHistoryIndex + offset;
    const nextEntry = dependencyHistory[nextIndex];
    if (!nextEntry) {
      return;
    }
    setDependencyHistoryIndex(nextIndex);
    setSelectedModule(nextEntry.module);
    setDependencyView(nextEntry.view);
  }

  function sameDependencyHistoryEntry(left: DependencyHistoryEntry | undefined, right: DependencyHistoryEntry) {
    return Boolean(left && left.view === right.view && left.module === right.module);
  }

  function showSymbols(row: ObjectRow) {
    const symbols = symbolsForObject(result, row.name);
    setModal({ kind: "symbols", title: `${row.name} 符号`, rows: symbols });
  }

  function showRemoved(name: string) {
    const rows = (result?.removedUnused.byObject[name]?.sections ?? []).slice().sort((a, b) => b.size - a.size);
    setModal({ kind: "removed", title: `${name} 移除段`, rows });
  }

  const disabledPage = (key: PageKey) => {
    if (!result && key !== "open") {
      return true;
    }
    if (key === "deadcode") {
      return !result?.capabilities.deadCode;
    }
    if (key === "library") {
      return !result?.capabilities.library;
    }
    if (key === "dependency") {
      return !result?.capabilities.dependencies;
    }
    return false;
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <FileCode2 size={24} />
          <div>
            <strong>EMView</strong>
            <span>Keil MAP / AXF</span>
          </div>
        </div>
        <nav>
          {pages.map((item) => {
            const Icon = item.icon;
            const disabled = disabledPage(item.key);
            return (
              <button
                type="button"
                key={item.key}
                className={page === item.key ? "active" : ""}
                disabled={disabled}
                onClick={() => setPage(item.key)}
                title={disabled && result ? "当前文件不提供该分析能力" : item.label}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-open-panel">
          <div className="drop-zone sidebar-drop-zone">
            <FolderOpen size={30} />
            <h2>打开文件</h2>
            <p>拖拽 .map / .axf / .elf 到这里</p>
            <button type="button" className="primary" onClick={chooseFile} disabled={busy}>
              选择文件
            </button>
          </div>
          <button type="button" className="secondary-action" onClick={exportHtmlReport} disabled={!result}>
            <Download size={15} />
            导出报告
          </button>
        </div>
      </aside>

      <main className="content">
        {!result && (
          <section className="empty-workspace">
            <FileCode2 size={36} />
            <h1>等待分析文件</h1>
            <p>从左侧下方打开或拖入 Keil MAP / AXF / ELF 文件。</p>
          </section>
        )}

        {page === "overview" && result && (
          <section className={`page overview-page ${objectView === "treemap" ? "treemap-overview-page" : ""}`}>
            <div className="section-heading">
              <h1>内存概览</h1>
            </div>
            <div className="metric-grid">
              {summaryMetrics.map(([label, value]) => (
                <div className="metric" key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            <div className="region-grid">
              {result.regions.map((region) => (
                <RegionCard key={region.name} region={region} />
              ))}
            </div>
            <div className="toolbar">
              <label>
                视图
                <select value={objectView} onChange={(event) => setObjectView(event.target.value as "table" | "treemap")}>
                  <option value="table">表格</option>
                  <option value="treemap">树图</option>
                </select>
              </label>
              {objectView === "treemap" && (
                <fieldset className="dimension-checks">
                  {dimensions.map((dimension) => (
                    <label key={dimension}>
                      <input
                        type="checkbox"
                        checked={treemapDimensions.includes(dimension)}
                        onChange={() => toggleTreemapDimension(dimension)}
                      />
                      <span>{dimensionLabel(dimension)}</span>
                    </label>
                  ))}
                </fieldset>
              )}
            </div>
            {objectView === "table" ? <ObjectTable rows={result.objects} onRowClick={showSymbols} /> : <Treemap objects={result.objects} dimensions={treemapDimensions} onObjectClick={showSymbols} />}
          </section>
        )}

        {page === "symbols" && result && (
          <section className="page symbols-page">
            <div className="section-heading">
              <h1>符号分析</h1>
              <div className="segmented">
                {symbolTabs.map((tab) => (
                  <button type="button" key={tab} className={symbolTab === tab ? "active" : ""} onClick={() => setSymbolTab(tab)}>
                    {tab === "summary" ? "汇总 / 段" : tab === "symbols" ? "符号" : "MAP 明细"}
                  </button>
                ))}
              </div>
            </div>
            {symbolTab === "summary" ? (
              <div className="symbol-stack">
                <section className="symbol-section summary-section">
                  <h2>占用汇总</h2>
                  <FirmwareSummaryView summary={result.firmwareSummary} />
                </section>
                <section className="symbol-section sections-section">
                  <h2>段</h2>
                  <SectionsTable rows={result.sections} />
                </section>
              </div>
            ) : (
              <section className={`symbol-section ${symbolTab === "symbols" ? "symbols-section" : "map-detail-section"}`}>
                {symbolTab === "symbols" ? <SymbolsTable rows={result.symbols} /> : <MapDetailsView result={result} />}
              </section>
            )}
          </section>
        )}

        {page === "deadcode" && result && (
          <section className="page">
            <div className="section-heading">
              <h1>死代码分析</h1>
            </div>
            <div className="metric-grid compact">
              <div className="metric">
                <span>总移除字节</span>
                <strong>{bytes(result.removedUnused.total)}</strong>
              </div>
              <div className="metric">
                <span>涉及对象数</span>
                <strong>{result.removedUnused.objectNames.length.toLocaleString()}</strong>
              </div>
              <div className="metric">
                <span>整体死代码率</span>
                <strong>{percent(deadRate(result))}</strong>
              </div>
            </div>
            <DataTable
              columns={[
                { key: "name", title: "对象文件", width: "2fr", render: (row) => row.name, sortValue: (row) => row.name, filterable: true },
                {
                  key: "removed",
                  title: "移除大小",
                  align: "right",
                  render: (row) => bytes(row.removed.total),
                  sortValue: (row) => row.removed.total,
                },
                { key: "rate", title: "死代码率", align: "right", render: (row) => percent(row.rate), sortValue: (row) => row.rate },
                {
                  key: "top",
                  title: "主要移除段",
                  width: "3fr",
                  render: (row) => row.removed.sections.slice(0, 4).map((section) => `${section.section} ${bytes(section.size)}`).join(" | "),
                  sortValue: (row) => row.removed.sections[0]?.size ?? 0,
                },
              ]}
              rows={deadRows}
              rowKey={(row) => row.name}
              onRowClick={(row) => showRemoved(row.name)}
              emptyText="当前文件没有死代码数据"
              minBodyHeight={380}
            />
          </section>
        )}

        {page === "library" && result && (
          <section className="page">
            <h1>库文件分析</h1>
            <div className="library-summary">
              <div className="panel rom-panel">
                <h2>ROM 占比</h2>
                <RomPieChart rows={librarySlices.slice(0, 7)} />
              </div>
              <div className="totals-stack">
                <div className="panel">
                  <h2>用户代码汇总</h2>
                  <p>{totalsText(result.library.objectTotals)}</p>
                </div>
                <div className="panel">
                  <h2>库代码汇总</h2>
                  <p>{totalsText(result.library.libraryTotals)}</p>
                </div>
              </div>
            </div>
            <LibraryMemberTable rows={result.library.members} memberToLibrary={result.memberToLibrary} />
          </section>
        )}

        {page === "dependency" && result && (
          <section className="page dependency-page">
            <div className="section-heading">
              <h1>模块依赖</h1>
              <div className="toolbar inline">
                <label>
                  视图
                  <select value={dependencyView} onChange={(event) => changeDependencyView(event.target.value as DependencyViewMode)}>
                    <option value="overview">总览</option>
                    <option value="module">当前模块</option>
                  </select>
                </label>
              </div>
            </div>
            <div className="dependency-layout">
              <div className="graph-stage">
                <div className="canvas-history-controls" aria-label="模块浏览历史">
                  <button
                    type="button"
                    className="history-icon-button back"
                    onClick={() => stepDependencyHistory(-1)}
                    disabled={dependencyHistoryIndex <= 0}
                    title="后退"
                  >
                    <span aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="history-icon-button"
                    onClick={() => stepDependencyHistory(1)}
                    disabled={dependencyHistoryIndex >= dependencyHistory.length - 1}
                    title="前进"
                  >
                    <span aria-hidden="true" />
                  </button>
                </div>
                <DependencyGraphView
                  graph={result.dependencies}
                  overview={dependencyView === "overview"}
                  selectedModule={selectedModule}
                  onSelect={(name) => selectDependencyModule(name)}
                  onOpen={(name) => openDependencyModule(name)}
                  onEdgeOpen={(edge) => setModal({ kind: "dependency", title: "依赖详情", edge })}
                />
                <div className={`module-panel ${moduleListCollapsed ? "collapsed" : ""}`}>
                  <div className="module-panel-titlebar">
                    <span>模块统计</span>
                    {!moduleListCollapsed && (
                      <>
                        <input
                          value={moduleFilter}
                          onChange={(event) => setModuleFilter(event.target.value)}
                          placeholder="过滤"
                          aria-label="过滤模块"
                        />
                        <select
                          value={dependencySort}
                          onChange={(event) => setDependencySort(event.target.value as "dependedBy" | "dependsOn")}
                          aria-label="模块排序"
                        >
                          <option value="dependedBy">被依赖</option>
                          <option value="dependsOn">依赖</option>
                        </select>
                      </>
                    )}
                    <button
                      type="button"
                      className="module-collapse-button"
                      onClick={() => setModuleListCollapsed((value) => !value)}
                      title={moduleListCollapsed ? "展开模块统计" : "收缩模块统计"}
                    >
                      {moduleListCollapsed ? <ChevronDown size={17} /> : <ChevronUp size={17} />}
                    </button>
                  </div>
                  {!moduleListCollapsed && (
                    <div className="module-list" role="list">
                      {filteredModules.length === 0 ? (
                        <div className="empty-state small">没有匹配模块</div>
                      ) : (
                        filteredModules.map((row) => (
                          <button
                            type="button"
                            key={row.name}
                            className={`module-row ${row.name === selectedModule ? "selected" : ""}`}
                            onClick={() => selectDependencyModule(row.name)}
                            onDoubleClick={() => openDependencyModule(row.name)}
                          >
                            <span title={row.name}>{row.name}</span>
                            <strong>被依赖 {row.dependedByCount} | 依赖 {row.dependsOnCount}</strong>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}
      </main>

      <div className={`status-toast ${busy ? "busy" : ""} ${statusVisible ? "visible" : ""}`} role="status" aria-live="polite">
        <span className="status-message">{status}</span>
        {result && <span className="format-pill">{result.sourceFormat}</span>}
      </div>

      {modal && (
        <Modal title={modal.title} onClose={() => setModal(null)} className={modal.kind === "symbols" ? "symbol-modal" : undefined}>
          {modal.kind === "symbols" ? (
            <SymbolsTable rows={modal.rows} showObjectColumn={false} />
          ) : modal.kind === "removed" ? (
            <RemovedTable rows={modal.rows} />
          ) : (
            <DependencyEdgeDetails edge={modal.edge} />
          )}
        </Modal>
      )}
    </div>
  );
}

function RegionCard({ region }: { region: Region }) {
  return (
      <div className="region-card">
      <strong>{region.name}</strong>
      <span>执行地址 {region.execBase}</span>
      <span>加载地址 {region.loadBase}</span>
      {region.attributes && <span>属性 {region.attributes}</span>}
      <div className="progress">
        <div style={{ width: `${Math.min(100, Math.max(0, region.usage))}%` }} />
      </div>
      <span>
        {bytes(region.size)} / {bytes(region.max)} ({percent(region.usage)})
      </span>
    </div>
  );
}

function ObjectTable({ rows, onRowClick }: { rows: ObjectRow[]; onRowClick: (row: ObjectRow) => void }) {
  const columns: Column<ObjectRow>[] = [
    { key: "name", title: "对象文件", width: "2.4fr", render: (row) => row.name, sortValue: (row) => row.name, filterable: true },
    { key: "code", title: "代码 (Code)", align: "right", render: (row) => row.code.toLocaleString(), sortValue: (row) => row.code },
    {
      key: "codeIncData",
      title: "含内联数据代码 (Code Inc)",
      align: "right",
      render: (row) => row.codeIncData.toLocaleString(),
      sortValue: (row) => row.codeIncData,
    },
    { key: "incData", title: "内联数据 (inc.data)", align: "right", render: (row) => row.incData.toLocaleString(), sortValue: (row) => row.incData },
    { key: "ro", title: "只读数据 (RO)", align: "right", render: (row) => row.ro.toLocaleString(), sortValue: (row) => row.ro },
    { key: "rw", title: "读写数据 (RW)", align: "right", render: (row) => row.rw.toLocaleString(), sortValue: (row) => row.rw },
    { key: "zi", title: "零初始化 (ZI)", align: "right", render: (row) => row.zi.toLocaleString(), sortValue: (row) => row.zi },
    { key: "rom", title: "ROM", align: "right", render: (row) => row.rom.toLocaleString(), sortValue: (row) => row.rom },
    { key: "ram", title: "RAM", align: "right", render: (row) => row.ram.toLocaleString(), sortValue: (row) => row.ram },
    { key: "debug", title: "调试信息", align: "right", render: (row) => row.debug.toLocaleString(), sortValue: (row) => row.debug },
  ];
  return <DataTable columns={columns} rows={rows} rowKey={(row) => row.name} onRowClick={onRowClick} minBodyHeight={420} />;
}

function LibraryMemberTable({ rows, memberToLibrary }: { rows: LibraryMember[]; memberToLibrary: Record<string, string> }) {
  return (
    <DataTable
      columns={[
        { key: "name", title: "库成员", width: "2fr", render: (row) => row.name, sortValue: (row) => row.name, filterable: true },
        {
          key: "library",
          title: "所属库",
          width: "1.8fr",
          render: (row) => memberToLibrary[row.name] ?? "-",
          sortValue: (row) => memberToLibrary[row.name] ?? "",
          filterable: true,
          filterValue: (row) => memberToLibrary[row.name] ?? "",
        },
        { key: "code", title: "代码 (Code)", align: "right", render: (row) => row.code.toLocaleString(), sortValue: (row) => row.code },
        { key: "ro", title: "只读数据 (RO)", align: "right", render: (row) => row.ro.toLocaleString(), sortValue: (row) => row.ro },
        { key: "rw", title: "读写数据 (RW)", align: "right", render: (row) => row.rw.toLocaleString(), sortValue: (row) => row.rw },
        { key: "zi", title: "零初始化 (ZI)", align: "right", render: (row) => row.zi.toLocaleString(), sortValue: (row) => row.zi },
        { key: "rom", title: "ROM", align: "right", render: (row) => row.rom.toLocaleString(), sortValue: (row) => row.rom },
        { key: "ram", title: "RAM", align: "right", render: (row) => row.ram.toLocaleString(), sortValue: (row) => row.ram },
      ]}
      rows={rows}
      rowKey={(row) => row.name}
      emptyText="当前文件没有库成员数据"
      minBodyHeight={380}
    />
  );
}

function RomPieChart({ rows }: { rows: Array<{ name: string; rom: number; total: number }> }) {
  const total = rows[0]?.total ?? 0;
  const slices = pieSlices(rows.filter((row) => row.rom > 0), total);

  if (total <= 0 || slices.length === 0) {
    return <div className="empty-state small">当前文件没有 ROM 占比数据</div>;
  }

  return (
    <div className="rom-pie-layout">
      <div className="rom-pie-figure" aria-label="ROM 占比饼图">
        <svg viewBox="0 0 220 220" role="img">
          <title>ROM 占比</title>
          {slices.map((slice) => (
            <path key={slice.name} d={slice.path} fill={slice.color}>
              <title>{`${slice.name}: ${bytes(slice.rom)} (${percent(slice.percent)})`}</title>
            </path>
          ))}
          <circle cx="110" cy="110" r="52" fill="#ffffff" />
          <text x="110" y="105" textAnchor="middle" className="rom-pie-total-label">
            ROM 总量
          </text>
          <text x="110" y="126" textAnchor="middle" className="rom-pie-total-value">
            {bytes(total)}
          </text>
        </svg>
      </div>
      <div className="rom-pie-legend">
        {slices.map((slice) => (
          <div className="rom-pie-legend-row" key={slice.name}>
            <span className="rom-pie-swatch" style={{ background: slice.color }} />
            <span className="rom-pie-name" title={slice.name}>
              {slice.name}
            </span>
            <span className="rom-pie-value">{bytes(slice.rom)}</span>
            <span className="rom-pie-percent">{percent(slice.percent)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const symbolTypeFilters = [
  { key: "FUNC", label: "函数" },
  { key: "OBJECT", label: "变量" },
  { key: "FILE", label: "文件标记" },
  { key: "SECTION", label: "段" },
  { key: "OTHER", label: "其他" },
];

const symbolBindingFilters = ["GLOBAL", "LOCAL", "WEAK", "UNKNOWN"];

function SymbolsTable({ rows, showObjectColumn = true }: { rows: SymbolEntry[]; showObjectColumn?: boolean }) {
  const [typeFilters, setTypeFilters] = useState(() => new Set(["FUNC", "OBJECT"]));
  const [bindingFilters, setBindingFilters] = useState(() => new Set(symbolBindingFilters));

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const type = normalizedSymbolType(row.symbolType);
      const binding = normalizedBinding(row.binding);
      return typeFilters.has(type) && bindingFilters.has(binding);
    });
  }, [rows, typeFilters, bindingFilters]);

  const columns: Column<SymbolEntry>[] = [
    { key: "name", title: "名称", width: "2fr", render: (row) => row.name, sortValue: (row) => row.name, filterable: true },
    { key: "address", title: "地址", width: "0.95fr", align: "right", render: (row) => hex(row.address), sortValue: (row) => row.address },
    { key: "size", title: "大小", width: "0.75fr", align: "right", render: (row) => bytes(row.size), sortValue: (row) => row.size },
    { key: "type", title: "类型", width: "0.7fr", render: (row) => symbolTypeLabel(row.symbolType), sortValue: (row) => normalizedSymbolType(row.symbolType) },
    { key: "binding", title: "绑定", width: "0.7fr", render: (row) => bindingLabel(row.binding), sortValue: (row) => normalizedBinding(row.binding) },
    { key: "section", title: "段", width: "1.25fr", render: (row) => row.section || "-", sortValue: (row) => row.section, filterable: true },
    ...(showObjectColumn
      ? [
          {
            key: "object",
            title: "对象文件",
            width: "1.35fr",
            render: (row: SymbolEntry) => row.object || "-",
            sortValue: (row: SymbolEntry) => row.object,
            filterable: true,
          },
        ]
      : []),
    {
      key: "sectionPercent",
      title: "% 段",
      width: "0.72fr",
      align: "right",
      render: (row) => (row.sectionPercent == null ? "-" : percent(row.sectionPercent)),
      sortValue: (row) => row.sectionPercent ?? -1,
    },
  ];

  function toggleTypeFilter(key: string) {
    setTypeFilters((current) => toggledSet(current, key));
  }

  function toggleBindingFilter(key: string) {
    setBindingFilters((current) => toggledSet(current, key));
  }

  return (
    <div className="symbol-panel">
      <div className="chip-row">
        <span className="filter-label">类型</span>
        <div className="chip-group">
          {symbolTypeFilters.map((filter) => (
            <button
              type="button"
              key={filter.key}
              className={typeFilters.has(filter.key) ? "chip active" : "chip"}
              onClick={() => toggleTypeFilter(filter.key)}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>
      <div className="chip-row binding-row">
        <div className="chip-group">
          <span className="filter-label">绑定</span>
          {symbolBindingFilters.map((binding) => (
            <button
              type="button"
              key={binding}
              className={bindingFilters.has(binding) ? "chip active" : "chip"}
              onClick={() => toggleBindingFilter(binding)}
            >
              {bindingLabel(binding)}
            </button>
          ))}
        </div>
        <span className="result-count">
          {filteredRows.length.toLocaleString()} / {rows.length.toLocaleString()}
        </span>
      </div>
      <DataTable
        className={showObjectColumn ? "symbol-data-table" : "symbol-data-table without-object"}
        columns={columns}
        rows={filteredRows}
        rowKey={(row, index) => `${symbolKey(row)}|${index}`}
        emptyText="没有符号数据"
        minBodyHeight={showObjectColumn ? 420 : 300}
      />
    </div>
  );
}

function SectionsTable({ rows }: { rows: SectionEntry[] }) {
  return (
    <DataTable
      columns={[
        { key: "name", title: "段", width: "2.2fr", render: (row) => row.name, sortValue: (row) => row.name, filterable: true },
        { key: "address", title: "地址", align: "right", render: (row) => hex(row.address), sortValue: (row) => row.address },
        { key: "size", title: "大小", align: "right", render: (row) => bytes(row.size), sortValue: (row) => row.size },
        { key: "flags", title: "标志", render: (row) => row.flags, sortValue: (row) => row.flags },
        {
          key: "align",
          title: "对齐",
          align: "right",
          render: (row) => (row.align > 0 ? row.align.toLocaleString() : "-"),
          sortValue: (row) => row.align,
        },
        { key: "source", title: "来源", render: (row) => row.source, sortValue: (row) => row.source, filterable: true },
      ]}
      rows={rows}
      rowKey={(row, index) => `${row.name}-${row.address}-${index}`}
      emptyText="没有段数据"
      minBodyHeight={320}
    />
  );
}

function MapDetailsView({ result }: { result: AnalysisResult }) {
  const details = result.mapDetails;
  const hasData = details.symbols.length > 0 || details.sections.length > 0 || details.crossReferences.length > 0;
  if (!hasData) {
    return <div className="empty-state small">当前文件没有可展示的 MAP 明细字段</div>;
  }
  return (
    <div className="map-detail-stack">
      <section className="symbol-section">
        <h2>MAP 符号明细</h2>
        <MapSymbolDetailsTable rows={details.symbols} />
      </section>
      <section className="symbol-section">
        <h2>MAP 段明细</h2>
        <MapSectionDetailsTable rows={details.sections} />
      </section>
      <section className="symbol-section">
        <h2>交叉引用</h2>
        <MapCrossReferenceTable rows={details.crossReferences} />
      </section>
    </div>
  );
}

function MapSymbolDetailsTable({ rows }: { rows: MapSymbolDetail[] }) {
  return (
    <DataTable
      columns={[
        { key: "name", title: "名称", width: "1.8fr", render: (row) => row.name || "-", sortValue: (row) => row.name, filterable: true },
        { key: "owner", title: "归属对象", width: "1.4fr", render: (row) => row.owner || "-", sortValue: (row) => row.owner, filterable: true },
        { key: "execAddr", title: "执行地址", width: "1fr", align: "right", render: (row) => row.execAddr || "-", sortValue: (row) => parseAddress(row.execAddr) },
        { key: "loadAddr", title: "加载地址", width: "1fr", align: "right", render: (row) => row.loadAddr || "-", sortValue: (row) => parseAddress(row.loadAddr) },
        { key: "size", title: "大小", width: "0.75fr", align: "right", render: (row) => bytes(row.size), sortValue: (row) => row.size },
        { key: "symbolType", title: "类型", width: "0.7fr", render: (row) => row.symbolType || "-", sortValue: (row) => row.symbolType },
        { key: "attr", title: "属性", width: "0.65fr", render: (row) => row.attr || "-", sortValue: (row) => row.attr },
        { key: "idx", title: "索引", width: "0.65fr", align: "right", render: (row) => row.idx.toLocaleString(), sortValue: (row) => row.idx },
        { key: "entry", title: "Entry", width: "0.65fr", render: (row) => (row.hasEntry ? "是" : "否"), sortValue: (row) => row.hasEntry },
        { key: "section", title: "段", width: "1.5fr", render: (row) => row.section || "-", sortValue: (row) => row.section, filterable: true },
        { key: "object", title: "对象引用", width: "1.6fr", render: (row) => row.object || "-", sortValue: (row) => row.object, filterable: true },
        { key: "library", title: "库", width: "1.2fr", render: (row) => row.library ?? "-", sortValue: (row) => row.library ?? "", filterable: true, filterValue: (row) => row.library ?? "" },
        { key: "source", title: "来源", width: "1fr", render: (row) => row.source, sortValue: (row) => row.source },
      ]}
      rows={rows}
      rowKey={(row, index) => `${row.execAddr}|${row.name}|${row.owner}|${index}`}
      emptyText="没有 MAP 符号明细"
      minBodyHeight={320}
    />
  );
}

function MapSectionDetailsTable({ rows }: { rows: MapSectionDetail[] }) {
  return (
    <DataTable
      columns={[
        { key: "name", title: "段", width: "1.8fr", render: (row) => row.name || "-", sortValue: (row) => row.name, filterable: true },
        { key: "outputSection", title: "输出段/执行区", width: "1.4fr", render: (row) => row.outputSection || "-", sortValue: (row) => row.outputSection, filterable: true },
        { key: "address", title: "地址", width: "1fr", align: "right", render: (row) => row.address || "-", sortValue: (row) => parseAddress(row.address) },
        { key: "loadAddress", title: "加载地址", width: "1fr", align: "right", render: (row) => row.loadAddress ?? "-", sortValue: (row) => parseAddress(row.loadAddress ?? "") },
        { key: "size", title: "大小", width: "0.75fr", align: "right", render: (row) => bytes(row.size), sortValue: (row) => row.size },
        { key: "class", title: "分类", width: "0.75fr", render: (row) => row.class || "-", sortValue: (row) => row.class },
        { key: "attr", title: "属性", width: "0.65fr", render: (row) => row.attr || "-", sortValue: (row) => row.attr },
        { key: "object", title: "对象文件", width: "1.6fr", render: (row) => row.object || "-", sortValue: (row) => row.object, filterable: true },
        { key: "library", title: "库", width: "1.2fr", render: (row) => row.library ?? "-", sortValue: (row) => row.library ?? "", filterable: true, filterValue: (row) => row.library ?? "" },
        { key: "source", title: "来源", width: "1.2fr", render: (row) => row.source, sortValue: (row) => row.source },
      ]}
      rows={rows}
      rowKey={(row, index) => `${row.address}|${row.name}|${row.object}|${index}`}
      emptyText="没有 MAP 段明细"
      minBodyHeight={320}
    />
  );
}

function MapCrossReferenceTable({ rows }: { rows: MapCrossReference[] }) {
  return (
    <DataTable
      columns={[
        { key: "sourceObject", title: "来源对象", width: "1.5fr", render: (row) => row.sourceObject, sortValue: (row) => row.sourceObject, filterable: true },
        { key: "sourceSection", title: "来源段", width: "1.7fr", render: (row) => row.sourceSection, sortValue: (row) => row.sourceSection, filterable: true },
        { key: "targetObject", title: "目标对象", width: "1.5fr", render: (row) => row.targetObject, sortValue: (row) => row.targetObject, filterable: true },
        { key: "targetSection", title: "目标段", width: "1.7fr", render: (row) => row.targetSection, sortValue: (row) => row.targetSection, filterable: true },
        { key: "symbol", title: "符号", width: "1.4fr", render: (row) => row.symbol, sortValue: (row) => row.symbol, filterable: true },
      ]}
      rows={rows}
      rowKey={(row, index) => `${row.sourceObject}|${row.sourceSection}|${row.targetObject}|${row.targetSection}|${row.symbol}|${index}`}
      emptyText="没有交叉引用明细"
      minBodyHeight={320}
    />
  );
}

function FirmwareSummaryView({ summary }: { summary: FirmwareSummary }) {
  const items = [
    ["代码段 (text)", bytes(summary.text)],
    ["数据段 (data)", bytes(summary.data)],
    ["BSS 段 (bss)", bytes(summary.bss)],
    ["闪存 (Flash)", bytes(summary.flash)],
    ["RAM", bytes(summary.ram)],
    ["入口地址", hexOrDash(summary.entry)],
    ["初始 SP", hexOrDash(summary.initialSp)],
    ["复位处理函数", hexOrDash(summary.resetHandler)],
  ];
  return (
    <div className="summary-grid">
      {items.map(([label, value]) => (
        <div className="metric" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function DependencyEdgeDetails({ edge }: { edge: DependencyEdge }) {
  return (
    <div className="dependency-detail">
      <div className="detail-grid">
        <div className="metric">
          <span>来源模块</span>
          <strong title={edge.source}>{edge.source}</strong>
        </div>
        <div className="metric">
          <span>目标模块</span>
          <strong title={edge.target}>{edge.target}</strong>
        </div>
        <div className="metric">
          <span>引用次数</span>
          <strong>{edge.count.toLocaleString()}</strong>
        </div>
      </div>
      <div className="panel">
        <h2>符号</h2>
        {edge.symbols.length === 0 ? (
          <p>当前依赖边没有符号明细。</p>
        ) : (
          <div className="symbol-list">
            {edge.symbols.map((symbol, index) => (
              <code key={`${symbol}-${index}`}>{symbol}</code>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RemovedTable({ rows }: { rows: RemovedSection[] }) {
  return (
    <DataTable
      columns={[
        { key: "section", title: "段", width: "3fr", render: (row) => row.section, sortValue: (row) => row.section, filterable: true },
        { key: "size", title: "大小", align: "right", render: (row) => bytes(row.size), sortValue: (row) => row.size },
        { key: "raw", title: "字节数", align: "right", render: (row) => `${row.size.toLocaleString()} B`, sortValue: (row) => row.size },
      ]}
      rows={rows}
      rowKey={(row, index) => `${row.section}-${index}`}
      emptyText="没有移除段数据"
      minBodyHeight={260}
    />
  );
}

function romFromTotals(totals: { codeIncData: number; ro: number; rw: number } | null): number {
  return totals ? totals.codeIncData + totals.ro + totals.rw : 0;
}

function deadRate(result: AnalysisResult): number {
  const totalRom = result.summary.totalRom ?? 0;
  const removed = result.removedUnused.total;
  return removed + totalRom > 0 ? (removed / (removed + totalRom)) * 100 : 0;
}

const pieColors = ["#2f6f63", "#d08a28", "#4c6fb3", "#9b5a9c", "#5a7d35", "#bd4f4f", "#3c8a9b", "#7670b2"];

function pieSlices(rows: Array<{ name: string; rom: number; total: number }>, total: number) {
  let cursor = -90;
  return rows.map((row, index) => {
    const sweep = total > 0 ? (row.rom / total) * 360 : 0;
    const start = cursor;
    const end = cursor + sweep;
    cursor = end;
    return {
      name: row.name,
      rom: row.rom,
      percent: total > 0 ? (row.rom / total) * 100 : 0,
      color: pieColors[index % pieColors.length],
      path: describeArc(110, 110, 94, start, end),
    };
  });
}

function describeArc(cx: number, cy: number, radius: number, startAngle: number, endAngle: number): string {
  if (endAngle - startAngle >= 359.999) {
    return [
      `M ${cx} ${cy}`,
      `m 0 ${-radius}`,
      `a ${radius} ${radius} 0 1 1 0 ${radius * 2}`,
      `a ${radius} ${radius} 0 1 1 0 ${-radius * 2}`,
      "Z",
    ].join(" ");
  }
  const start = polarToCartesian(cx, cy, radius, startAngle);
  const end = polarToCartesian(cx, cy, radius, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return [`M ${cx} ${cy}`, `L ${start.x} ${start.y}`, `A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`, "Z"].join(" ");
}

function polarToCartesian(cx: number, cy: number, radius: number, angle: number) {
  const radians = (angle * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians),
  };
}

function symbolsForObject(result: AnalysisResult | null, objectName: string): SymbolEntry[] {
  if (!result) {
    return [];
  }
  const direct = result.symbols.filter((symbol) => symbol.object === objectName);
  if (direct.length > 0) {
    return direct.slice().sort((a, b) => b.size - a.size);
  }
  return (result.symbolsByObject[objectName] ?? [])
    .filter((symbol) => symbol.symbolType !== "PAD")
    .map((row) => ({
      name: symbolNameFromLegacy(row),
      address: parseAddress(row.execAddr),
      size: row.size,
      symbolType: legacySymbolType(row),
      binding: "UNKNOWN",
      section: row.section,
      object: objectName,
      sectionPercent: null,
    }))
    .sort((a, b) => b.size - a.size);
}

function symbolNameFromLegacy(row: SymbolRow): string {
  return row.section.replace(/^\.text\./, "").replace(/^\.data\./, "").replace(/^\.bss\./, "").replace(/^\.rodata\./, "");
}

function legacySymbolType(row: SymbolRow): string {
  if (row.symbolType === "Code" || row.section.startsWith(".text")) {
    return "FUNC";
  }
  if (row.symbolType === "Data" || row.section.startsWith(".data") || row.section.startsWith(".bss") || row.section.startsWith(".rodata")) {
    return "OBJECT";
  }
  return row.section.startsWith(".") ? "SECTION" : "OTHER";
}

function parseAddress(value: string): number {
  const parsed = Number.parseInt(value.replace(/^0x/i, ""), 16);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildHtmlReport(result: AnalysisResult): string {
  const generatedAt = new Date().toLocaleString();
  const dependencyRows = dependencyReportRows(result.dependencies.edges);
  const reportData = {
    sourceFormat: result.sourceFormat,
    generatedAt,
    summary: result.summary,
    firmwareSummary: result.firmwareSummary,
    regions: result.regions,
    objects: result.objects,
    sections: result.sections,
    symbols: result.symbols,
    mapDetails: result.mapDetails,
    libraries: result.library.members,
    dependencies: dependencyRows,
    totals: {
      objectCount: result.objects.length,
      sectionCount: result.sections.length,
      symbolCount: result.symbols.length,
      libraryMemberCount: result.library.members.length,
      dependencyCount: result.dependencies.edges.length,
      mapSymbolDetailCount: result.mapDetails.symbols.length,
      mapSectionDetailCount: result.mapDetails.sections.length,
      crossReferenceCount: result.mapDetails.crossReferences.length,
    },
  };

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>EMView 交互报告</title>
  <style>
    :root { color: #1f2937; background: #f5f8fb; font-family: "Segoe UI", "Microsoft YaHei", system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; }
    header { position: sticky; top: 0; z-index: 2; padding: 16px 22px; background: #fff; border-bottom: 1px solid #dbe2ea; }
    h1, h2 { margin: 0; letter-spacing: 0; }
    h1 { font-size: 22px; }
    h2 { font-size: 16px; color: #344054; }
    main { display: grid; gap: 14px; padding: 16px 22px 28px; }
    .meta { margin-top: 6px; color: #667085; font-size: 13px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; }
    .card, section { min-width: 0; background: #fff; border: 1px solid #dbe2ea; border-radius: 6px; }
    .card { display: grid; gap: 5px; padding: 12px; }
    .card span { color: #667085; font-size: 12px; }
    .card strong { overflow: hidden; font-size: 18px; text-overflow: ellipsis; white-space: nowrap; }
    section { display: grid; gap: 10px; padding: 12px; }
    .table-tools { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
    input { min-height: 30px; width: min(300px, 100%); padding: 0 9px; border: 1px solid #cfd7e2; border-radius: 6px; }
    .table-wrap { overflow: auto; border: 1px solid #e4e8ef; border-radius: 6px; max-height: 520px; }
    table { width: 100%; min-width: 780px; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 8px 9px; border-bottom: 1px solid #eef1f5; text-align: left; white-space: nowrap; vertical-align: top; }
    th { position: sticky; top: 0; background: #eef2f6; color: #475467; cursor: pointer; user-select: none; }
    td.wrap { white-space: normal; line-height: 1.5; }
    td.numeric, th.numeric { text-align: right; font-variant-numeric: tabular-nums; }
    tr:hover td { background: #f8fafc; }
    .note { color: #667085; font-size: 12px; }
  </style>
</head>
<body>
  <header>
    <h1>EMView 报告</h1>
    <div class="meta">生成时间：${escapeHtml(generatedAt)}</div>
  </header>
  <main>
    <div class="grid">
      ${metricCard("只读总量 (RO)", bytes(result.summary.totalRo))}
      ${metricCard("读写总量 (RW)", bytes(result.summary.totalRw))}
      ${metricCard("ROM 总量", bytes(result.summary.totalRom))}
      ${metricCard("已移除未使用代码", bytes(result.summary.removedUnusedSections))}
      ${metricCard("对象文件数", result.objects.length.toLocaleString())}
      ${metricCard("符号数", result.symbols.length.toLocaleString())}
    </div>
    ${reportTable("regions", "内存区域", result.regions, [
      { key: "name", title: "名称" },
      { key: "execBase", title: "执行地址" },
      { key: "loadBase", title: "加载地址" },
      { key: "attributes", title: "属性" },
      { key: "size", title: "大小", align: "numeric", formatter: bytes },
      { key: "max", title: "最大值", align: "numeric", formatter: bytes },
      { key: "usage", title: "使用率", align: "numeric", formatter: percent },
    ])}
    ${reportTable("objects", `对象文件 (${result.objects.length})`, result.objects, objectReportColumns())}
    ${reportTable("sections", `段 (${result.sections.length})`, result.sections, [
      { key: "name", title: "段" },
      { key: "address", title: "地址", align: "numeric", formatter: hex },
      { key: "size", title: "大小", align: "numeric", formatter: bytes },
      { key: "flags", title: "标志" },
      { key: "align", title: "对齐", align: "numeric" },
      { key: "source", title: "来源" },
    ])}
    ${reportTable("symbols", `符号 (${result.symbols.length})`, result.symbols, [
      { key: "name", title: "名称" },
      { key: "address", title: "地址", align: "numeric", formatter: hex },
      { key: "size", title: "大小", align: "numeric", formatter: bytes },
      { key: "symbolType", title: "类型" },
      { key: "binding", title: "绑定" },
      { key: "section", title: "段" },
      { key: "object", title: "对象文件" },
    ])}
    ${reportTable("map-symbols", `MAP 符号明细 (${result.mapDetails.symbols.length})`, result.mapDetails.symbols, [
      { key: "name", title: "名称", search: true },
      { key: "owner", title: "归属对象", search: true },
      { key: "execAddr", title: "执行地址", align: "numeric" },
      { key: "loadAddr", title: "加载地址", align: "numeric" },
      { key: "size", title: "大小", align: "numeric", formatter: bytes },
      { key: "symbolType", title: "类型" },
      { key: "attr", title: "属性" },
      { key: "idx", title: "索引", align: "numeric" },
      { key: "hasEntry", title: "Entry" },
      { key: "section", title: "段", search: true },
      { key: "object", title: "对象引用", search: true },
      { key: "library", title: "库", search: true },
      { key: "source", title: "来源" },
    ])}
    ${reportTable("map-sections", `MAP 段明细 (${result.mapDetails.sections.length})`, result.mapDetails.sections, [
      { key: "name", title: "段", search: true },
      { key: "outputSection", title: "输出段/执行区", search: true },
      { key: "address", title: "地址", align: "numeric" },
      { key: "loadAddress", title: "加载地址", align: "numeric" },
      { key: "size", title: "大小", align: "numeric", formatter: bytes },
      { key: "class", title: "分类" },
      { key: "attr", title: "属性" },
      { key: "object", title: "对象文件", search: true },
      { key: "library", title: "库", search: true },
      { key: "source", title: "来源" },
    ])}
    ${reportTable("cross-references", `交叉引用 (${result.mapDetails.crossReferences.length})`, result.mapDetails.crossReferences, [
      { key: "sourceObject", title: "来源对象", search: true },
      { key: "sourceSection", title: "来源段", search: true },
      { key: "targetObject", title: "目标对象", search: true },
      { key: "targetSection", title: "目标段", search: true },
      { key: "symbol", title: "符号", search: true },
    ])}
    ${reportTable("libraries", `库成员 (${result.library.members.length})`, result.library.members, objectReportColumns("库成员"))}
    ${reportTable("dependencies", `依赖关系 (${dependencyRows.length} 个来源 / ${result.dependencies.edges.length} 条边)`, dependencyRows, [
      { key: "source", title: "来源模块" },
      { key: "targets", title: "目标模块", wrap: true },
      { key: "targetCount", title: "目标数", align: "numeric" },
      { key: "referenceCount", title: "引用次数", align: "numeric" },
    ])}
  </main>
  <script id="report-data" type="application/json">${escapeScriptJson(JSON.stringify(reportData))}</script>
  <script>
    document.querySelectorAll("[data-table]").forEach((section) => {
      const input = section.querySelector("input");
      const rows = Array.from(section.querySelectorAll("tbody tr"));
      input && input.addEventListener("input", () => {
        const query = input.value.trim().toLowerCase();
        const indexes = input.dataset.searchIndexes ? input.dataset.searchIndexes.split(",").filter(Boolean).map(Number) : [];
        rows.forEach((row) => {
          const targetText = indexes.length > 0
            ? indexes.map((index) => row.children[index]?.textContent || "").join(" ")
            : row.textContent;
          row.hidden = query && !targetText.toLowerCase().includes(query);
        });
      });
      section.querySelectorAll("th").forEach((th, index) => {
        th.addEventListener("click", () => {
          const tbody = section.querySelector("tbody");
          const direction = th.dataset.direction === "asc" ? "desc" : "asc";
          section.querySelectorAll("th").forEach((item) => item.dataset.direction = "");
          th.dataset.direction = direction;
          rows.sort((a, b) => {
            const av = a.children[index].dataset.value || a.children[index].textContent;
            const bv = b.children[index].dataset.value || b.children[index].textContent;
            const an = Number(av);
            const bn = Number(bv);
            const result = Number.isFinite(an) && Number.isFinite(bn) ? an - bn : av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" });
            return direction === "asc" ? result : -result;
          });
          rows.forEach((row) => tbody.appendChild(row));
        });
      });
    });
  </script>
</body>
</html>`;
}

interface ReportColumn<T> {
  key: keyof T & string;
  title: string;
  align?: "numeric";
  wrap?: boolean;
  search?: boolean;
  formatter?: (value: never) => string;
}

function objectReportColumns(title = "对象文件"): ReportColumn<ObjectRow>[] {
  return [
    { key: "name", title, search: true },
    { key: "code", title: "代码 (Code)", align: "numeric" },
    { key: "codeIncData", title: "含内联数据代码 (Code Inc)", align: "numeric" },
    { key: "incData", title: "内联数据 (inc.data)", align: "numeric" },
    { key: "ro", title: "只读数据 (RO)", align: "numeric" },
    { key: "rw", title: "读写数据 (RW)", align: "numeric" },
    { key: "zi", title: "零初始化 (ZI)", align: "numeric" },
    { key: "rom", title: "ROM", align: "numeric" },
    { key: "ram", title: "RAM", align: "numeric" },
    { key: "debug", title: "调试信息", align: "numeric" },
  ];
}

function metricCard(label: string, value: string): string {
  return `<div class="card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function reportTable<T extends object>(id: string, title: string, rows: T[], columns: ReportColumn<T>[]): string {
  const searchIndexes = columns
    .map((column, index) => (column.search || isNameLikeColumn(column.key) ? index : -1))
    .filter((index) => index >= 0);
  return `<section data-table="${escapeHtml(id)}">
    <div class="table-tools">
      <h2>${escapeHtml(title)}</h2>
      <input type="search" placeholder="搜索名称" data-search-indexes="${escapeHtml(searchIndexes.join(","))}" />
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>${columns.map((column) => `<th class="${column.align === "numeric" ? "numeric" : ""}">${escapeHtml(column.title)}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((row) => reportRow(row, columns)).join("")}</tbody>
      </table>
    </div>
  </section>`;
}

function reportRow<T extends object>(row: T, columns: ReportColumn<T>[]): string {
  const record = row as Record<string, unknown>;
  return `<tr>${columns
    .map((column) => {
      const value = record[column.key];
      const display = column.formatter ? column.formatter(value as never) : reportValue(value);
      const raw = typeof value === "number" ? String(value) : display;
      return `<td class="${[column.align === "numeric" ? "numeric" : "", column.wrap ? "wrap" : ""].filter(Boolean).join(" ")}" data-value="${escapeHtml(raw)}">${escapeHtml(display)}</td>`;
    })
    .join("")}</tr>`;
}

function isNameLikeColumn(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized === "name" || normalized.includes("object") || normalized.includes("section") || normalized.includes("source") || normalized.includes("target") || normalized.includes("library") || normalized.includes("symbol");
}

interface DependencyReportRow {
  source: string;
  targets: string;
  targetCount: number;
  referenceCount: number;
}

function dependencyReportRows(edges: DependencyEdge[]): DependencyReportRow[] {
  const rows = new Map<string, { targets: Array<{ target: string; count: number }>; referenceCount: number }>();
  for (const edge of edges) {
    const row = rows.get(edge.source) ?? { targets: [], referenceCount: 0 };
    row.targets.push({ target: edge.target, count: edge.count });
    row.referenceCount += edge.count;
    rows.set(edge.source, row);
  }
  return Array.from(rows.entries())
    .map(([source, row]) => ({
      source,
      targets: row.targets
        .sort((a, b) => b.count - a.count || a.target.localeCompare(b.target))
        .map((target) => `${target.target} (${target.count.toLocaleString()})`)
        .join(" | "),
      targetCount: row.targets.length,
      referenceCount: row.referenceCount,
    }))
    .sort((a, b) => b.referenceCount - a.referenceCount || a.source.localeCompare(b.source));
}

function reportValue(value: unknown): string {
  if (value == null) {
    return "-";
  }
  return typeof value === "number" ? value.toLocaleString() : String(value);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function escapeScriptJson(value: string): string {
  return value.replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

function hex(value: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  const normalized = Math.max(0, Math.trunc(value));
  const width = normalized > 0xffffffff ? 16 : 8;
  return `0x${normalized.toString(16).padStart(width, "0")}`;
}

function hexOrDash(value: number | null): string {
  return value == null ? "-" : hex(value);
}

function symbolKey(row: SymbolEntry): string {
  return `${row.name}|${row.address}|${row.size}|${row.section}|${row.object}`;
}

function normalizedSymbolType(value: string): string {
  const upper = value.toUpperCase();
  if (upper === "FUNC" || upper === "FUNCTION" || upper === "CODE") {
    return "FUNC";
  }
  if (upper === "OBJECT" || upper === "VARIABLE" || upper === "DATA" || upper === "COMMON" || upper === "TLS") {
    return "OBJECT";
  }
  if (upper === "FILE") {
    return "FILE";
  }
  if (upper === "SECTION") {
    return "SECTION";
  }
  return "OTHER";
}

function symbolTypeLabel(value: string): string {
  switch (normalizedSymbolType(value)) {
    case "FUNC":
      return "函数";
    case "OBJECT":
      return "变量";
    case "FILE":
      return "文件标记";
    case "SECTION":
      return "段";
    default:
      return "其他";
  }
}

function normalizedBinding(value: string): string {
  const upper = value.toUpperCase();
  return symbolBindingFilters.includes(upper) ? upper : "UNKNOWN";
}

function bindingLabel(value: string): string {
  return normalizedBinding(value);
}

function toggledSet(current: Set<string>, key: string): Set<string> {
  const next = new Set(current);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  return next;
}

export default App;
