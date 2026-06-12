import { useMemo, useRef, useState, type ReactNode } from "react";

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
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  emptyText?: string;
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  emptyText = "没有数据",
  className,
}: DataTableProps<T>) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [sort, setSort] = useState<{ key: string; direction: SortDirection } | null>(null);
  const template = columns.map((column) => column.width ?? "1fr").join(" ");
  const sortedRows = useMemo(() => {
    if (!sort) {
      return rows;
    }
    const column = columns.find((item) => item.key === sort.key);
    if (!column || column.sortable === false) {
      return rows;
    }
    return rows
      .map((row, index) => ({ row, index }))
      .sort((a, b) => {
        const value = compareSortValues(getSortValue(column, a.row), getSortValue(column, b.row), sort.direction);
        return value === 0 ? a.index - b.index : value;
      })
      .map((item) => item.row);
  }, [columns, rows, sort]);
  const virtualRows = useVirtualRows(bodyRef, { count: sortedRows.length, rowHeight: 36, overscan: 12 });
  const visibleRows = sortedRows.slice(virtualRows.startIndex, virtualRows.endIndex);

  function toggleSort(column: Column<T>) {
    if (column.sortable === false) {
      return;
    }
    setSort((current) => ({
      key: column.key,
      direction: current?.key === column.key && current.direction === "asc" ? "desc" : "asc",
    }));
  }

  return (
    <div className={`data-table ${className ?? ""}`}>
      <div className="table-row table-header" style={{ gridTemplateColumns: template }}>
        {columns.map((column) => {
          const active = sort?.key === column.key;
          return (
            <button
              type="button"
              key={column.key}
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
          );
        })}
      </div>
      <div className="table-body" ref={bodyRef}>
        {sortedRows.length === 0 ? (
          <div className="empty-state small">{emptyText}</div>
        ) : (
          <div className="virtual-list" style={{ height: virtualRows.totalHeight }}>
            <div className="virtual-window" style={{ transform: `translateY(${virtualRows.offsetTop}px)` }}>
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
                    {columns.map((column) => (
                      <span key={column.key} className={column.align === "right" ? "numeric" : undefined}>
                        {column.render(row)}
                      </span>
                    ))}
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

function getSortValue<T>(column: Column<T>, row: T): SortValue {
  if (column.sortValue) {
    return column.sortValue(row);
  }
  return reactNodeText(column.render(row));
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
