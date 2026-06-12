import type { ObjectRow, Totals, TreemapDimension } from "./types/analysis";

export function bytes(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "-";
  }
  const abs = Math.abs(value);
  if (abs >= 1024 * 1024) {
    return `${(value / 1024 / 1024).toFixed(2)} MB`;
  }
  if (abs >= 1024) {
    return `${(value / 1024).toFixed(2)} KB`;
  }
  return `${value.toLocaleString()} B`;
}

export function percent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "-";
  }
  return `${value.toFixed(2)}%`;
}

export function totalsText(totals: Totals | null): string {
  if (!totals) {
    return "-";
  }
  return `代码 (Code) ${totals.codeIncData.toLocaleString()} | 只读数据 (RO) ${totals.ro.toLocaleString()} | 读写数据 (RW) ${totals.rw.toLocaleString()} | 零初始化 (ZI) ${totals.zi.toLocaleString()} | 调试信息 ${totals.debug.toLocaleString()}`;
}

export function valueFor(row: ObjectRow, dimension: TreemapDimension): number {
  return row[dimension] ?? 0;
}

export function dimensionLabel(dimension: TreemapDimension): string {
  switch (dimension) {
    case "codeIncData":
      return "含内联数据代码 (Code Inc)";
    case "incData":
      return "内联数据 (inc.data)";
    case "ro":
      return "只读数据 (RO)";
    case "rw":
      return "读写数据 (RW)";
    case "zi":
      return "零初始化 (ZI)";
    case "rom":
      return "ROM";
    case "ram":
      return "RAM";
    case "debug":
      return "调试信息";
    default:
      return "代码 (Code)";
  }
}

export function shortName(name: string): string {
  const normalized = name.replace(/\\/g, "/");
  return normalized.split("/").pop() || name;
}
