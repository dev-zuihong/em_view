import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Search, X } from "lucide-react";

import { useVirtualRows } from "../hooks/useVirtualRows";

type SortDirection = "asc" | "desc";
type SortValue = string | number | boolean | null | undefined;

export interface Column<T> {
  key: string;
  title: string;
  align?: "left" | "right";
  width?: string;
  render: (row: T) => ReactNode;
  sortValue?: (row: T) => SortValue;
  sortable?: boolean;
  filterable?: boolean;
  filterPlaceholder?: string;
  filterValue?: (row: T) => string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  emptyText?: string;
  className?: string;
  minBodyHeight?: number;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  emptyText = "没有数据",
  className,
  minBodyHeight = 320,
}: DataTableProps<T>) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [sort, setSort] = useState<{ key: string; direction: SortDirection } | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const hasFilters = columns.some((column) => column.filterable);
  const template = columns.map((column) => normalizeColumnWidth(column)).join(" ");
  const filteredRows = useMemo(() => {
    const activeFilters = columns
      .map((column) => ({ column, query: filters[column.key]?.trim().toLowerCase() ?? "" }))
      .filter((item) => item.column.filterable && item.query);
    if (activeFilters.length === 0) {
      return rows;
    }
    return rows.filter((row) =>
      activeFilters.every(({ column, query }) => getFilterValue(column, row).toLowerCase().includes(query)),
    );
  }, [columns, filters, rows]);
  const sortedRows = useMemo(() => {
    if (!sort) {
      return filteredRows;
    }
    const column = columns.find((item) => item.key === sort.key);
    if (!column || column.sortable === false) {
      return filteredRows;
    }
    return filteredRows
      .map((row, index) => ({ row, index }))
      .sort((a, b) => {
        const value = compareSortValues(getSortValue(column, a.row), getSortValue(column, b.row), sort.direction);
        return value === 0 ? a.index - b.index : value;
      })
      .map((item) => item.row);
  }, [columns, filteredRows, sort]);
  const virtualRows = useVirtualRows(bodyRef, { count: sortedRows.length, rowHeight: 36, overscan: 12 });
  const visibleRows = sortedRows.slice(virtualRows.startIndex, virtualRows.endIndex);

  useEffect(() => {
    const body = bodyRef.current;
    const header = headerRef.current;
    if (!body || !header) {
      return;
    }
    const syncScroll = () => {
      header.scrollLeft = body.scrollLeft;
    };
    syncScroll();
    body.addEventListener("scroll", syncScroll, { passive: true });
    return () => body.removeEventListener("scroll", syncScroll);
  }, []);

  function toggleSort(column: Column<T>) {
    if (column.sortable === false) {
      return;
    }
    setSort((current) => ({
      key: column.key,
      direction: current?.key === column.key && current.direction === "asc" ? "desc" : "asc",
    }));
  }

  function changeFilter(column: Column<T>, value: string) {
    setFilters((current) => ({ ...current, [column.key]: value }));
  }

  function toggleFilter(column: Column<T>) {
    setOpenFilter((current) => (current === column.key ? null : column.key));
  }

  function clearFilter(column: Column<T>) {
    setFilters((current) => {
      const next = { ...current };
      delete next[column.key];
      return next;
    });
    setOpenFilter(null);
  }

  return (
    <div className={`data-table ${className ?? ""}`}>
      <div className="table-header-scroll" ref={headerRef}>
        <div
          className={`table-row table-header ${hasFilters ? "has-filters" : ""}`}
          style={{ gridTemplateColumns: template }}
        >
          {columns.map((column) => {
            const active = sort?.key === column.key;
            const filterValue = filters[column.key] ?? "";
            const filterOpen = openFilter === column.key;
            return (
              <div
                key={column.key}
                className={[
                  "table-header-cell",
                  column.align === "right" ? "numeric" : "",
                  column.filterable ? "filterable" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <button
                  type="button"
                  className={[
                    "table-sort-button",
                    column.align === "right" ? "numeric" : "",
                    active ? "active" : "",
                    column.sortable === false ? "disabled" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => toggleSort(column)}
                  disabled={column.sortable === false}
                  aria-label={`按 ${column.title} 排序`}
                >
                  <span className="table-sort-title">{column.title}</span>
                  <span className="table-sort-indicator">{active ? (sort.direction === "asc" ? "↑" : "↓") : ""}</span>
                </button>
                {column.filterable && (
                  <div className="table-filter-control">
                    {filterOpen ? (
                      <div className="table-filter-inline">
                        <Search size={14} />
                        <input
                          type="search"
                          value={filterValue}
                          autoFocus
                          onChange={(event) => changeFilter(column, event.target.value)}
                          placeholder={column.filterPlaceholder ?? `搜索${column.title}`}
                          aria-label={`按 ${column.title} 搜索`}
                        />
                        <button type="button" className="table-filter-clear" onClick={() => clearFilter(column)} aria-label="关闭搜索">
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className={`table-filter-toggle ${filterValue ? "active" : ""}`}
                        onClick={() => toggleFilter(column)}
                        aria-label={`搜索 ${column.title}`}
                        title={`搜索 ${column.title}`}
                      >
                        <Search size={14} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="table-body" ref={bodyRef} style={{ minHeight: minBodyHeight }}>
        {sortedRows.length === 0 ? (
          <div className="empty-state small table-empty-placeholder">{emptyText}</div>
        ) : (
          <div className="virtual-list" style={{ height: virtualRows.totalHeight }}>
            <div
              className="virtual-window"
              style={{ transform: `translateY(${virtualRows.offsetTop}px)` }}
            >
              {visibleRows.map((row, index) => {
                const rowIndex = virtualRows.startIndex + index;
                return (
                  <button
                    type="button"
                    key={rowKey(row, rowIndex)}
                    className={`table-row table-button ${onRowClick ? "clickable" : ""}`}
                    style={{ gridTemplateColumns: template }}
                    onClick={() => onRowClick?.(row)}
                    disabled={!onRowClick}
                  >
                    {columns.map((column) => {
                      const rendered = column.render(row);
                      const title = cellTitle(column, row, rendered);
                      return (
                        <span key={column.key} className={column.align === "right" ? "numeric" : undefined} title={title}>
                          {rendered}
                        </span>
                      );
                    })}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function normalizeColumnWidth<T>(column: Column<T>): string {
  const width = column.width ?? "1fr";
  if (/^\d*\.?\d+fr$/.test(width)) {
    return `minmax(0, ${width})`;
  }
  const pixelWidth = /^(\d+(?:\.\d+)?)px$/.exec(width);
  if (pixelWidth) {
    return `minmax(0, ${width})`;
  }
  return width;
}

function getSortValue<T>(column: Column<T>, row: T): SortValue {
  if (column.sortValue) {
    return column.sortValue(row);
  }
  return reactNodeText(column.render(row));
}

function getFilterValue<T>(column: Column<T>, row: T): string {
  if (column.filterValue) {
    return column.filterValue(row);
  }
  return reactNodeText(column.render(row));
}

function cellTitle<T>(column: Column<T>, row: T, rendered: ReactNode): string | undefined {
  const text = column.filterValue?.(row) || reactNodeText(rendered);
  return text.trim() || undefined;
}

function reactNodeText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") {
    return "";
  }
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map((item) => reactNodeText(item)).join("");
  }
  return "";
}

function compareSortValues(a: SortValue, b: SortValue, direction: SortDirection): number {
  const aEmpty = a == null;
  const bEmpty = b == null;
  if (aEmpty && bEmpty) {
    return 0;
  }
  if (aEmpty) {
    return 1;
  }
  if (bEmpty) {
    return -1;
  }

  const factor = direction === "asc" ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") {
    return (a - b) * factor;
  }
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" }) * factor;
}
