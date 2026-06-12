import { useMemo, useRef } from "react";

import { bytes, dimensionLabel, valueFor } from "../format";
import { useElementSize } from "../hooks/useElementSize";
import type { ObjectRow, TreemapDimension } from "../types/analysis";

interface TreemapProps {
  objects: ObjectRow[];
  dimensions: TreemapDimension[];
  onObjectClick: (row: ObjectRow) => void;
}

interface TreemapItem {
  row: ObjectRow;
  value: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LayoutItem {
  item: TreemapItem;
  area: number;
}

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const palette = [
  "#2b7cb5",
  "#de6148",
  "#3b926b",
  "#e6ab40",
  "#7c5bb2",
  "#359fb9",
  "#c45691",
  "#76963f",
  "#656971",
  "#c37435",
];

export function Treemap({ objects, dimensions, onObjectClick }: TreemapProps) {
  const treemapRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(treemapRef);
  const layoutWidth = Math.max(1, size.width);
  const layoutHeight = Math.max(1, size.height);
  const items = useMemo(() => layoutTreemap(objects, dimensions, layoutWidth, layoutHeight), [objects, dimensions, layoutWidth, layoutHeight]);
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const label = dimensions.map((dimension) => dimensionLabel(dimension)).join(" + ");

  if (objects.length === 0) {
    return <div className="empty-state">没有对象文件数据</div>;
  }
  if (items.length === 0) {
    return <div className="empty-state">没有 {label} 数据</div>;
  }

  return (
    <div ref={treemapRef} className="treemap" role="list" aria-label={`${label} 树图`}>
      {items.map((item, index) => {
        const percent = total > 0 ? (item.value / total) * 100 : 0;
        const pixelWidth = (item.width / 100) * layoutWidth;
        const pixelHeight = (item.height / 100) * layoutHeight;
        const showTitle = pixelWidth >= 58 && pixelHeight >= 24;
        const showBytes = pixelWidth >= 86 && pixelHeight >= 44;
        return (
          <button
            type="button"
            key={`${item.row.name}-${index}`}
            className="treemap-tile"
            role="listitem"
            title={`${item.row.name}\n${label}: ${bytes(item.value)} (${percent.toFixed(2)}%)`}
            onClick={() => onObjectClick(item.row)}
            style={{
              left: `${item.x}%`,
              top: `${item.y}%`,
              width: `${item.width}%`,
              height: `${item.height}%`,
              background: palette[index % palette.length],
            }}
          >
            {showTitle && <span className="treemap-name">{item.row.name}</span>}
            {showBytes && <span className="treemap-value">{bytes(item.value)}</span>}
          </button>
        );
      })}
    </div>
  );
}

function layoutTreemap(objects: ObjectRow[], dimensions: TreemapDimension[], width: number, height: number): TreemapItem[] {
  if (width <= 0 || height <= 0 || !Number.isFinite(width) || !Number.isFinite(height)) {
    return [];
  }

  const selectedDimensions: TreemapDimension[] = dimensions.length > 0 ? dimensions : ["code"];
  const items = objects
    .map((row) => {
      const value = selectedDimensions.reduce((sum, dimension) => sum + valueFor(row, dimension), 0);
      return {
        row,
        value,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      };
    })
    .filter((item) => Number.isFinite(item.value) && item.value > 0)
    .sort((a, b) => b.value - a.value);
  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (total <= 0) {
    return [];
  }

  const remaining: LayoutItem[] = items.map((item) => ({ item, area: (item.value / total) * width * height }));
  let bounds: Bounds = { x: 0, y: 0, width, height };
  let row: LayoutItem[] = [];

  while (remaining.length > 0) {
    const next = remaining[0];
    const side = Math.min(bounds.width, bounds.height);
    if (side <= 0) {
      break;
    }
    const currentWorst = row.length === 0 ? Number.POSITIVE_INFINITY : worstAspect(row, side);
    const nextWorst = worstAspect([...row, next], side);
    if (row.length === 0 || nextWorst <= currentWorst) {
      row.push(next);
      remaining.shift();
    } else {
      bounds = layoutSquarifiedRow(row, bounds);
      row = [];
    }
  }

  if (row.length > 0) {
    layoutSquarifiedRow(row, bounds);
  }

  return items.map((item) => ({
    ...item,
    x: Math.max(0, (item.x / width) * 100),
    y: Math.max(0, (item.y / height) * 100),
    width: Math.max(0, (item.width / width) * 100),
    height: Math.max(0, (item.height / height) * 100),
  }));
}

function worstAspect(row: LayoutItem[], side: number): number {
  if (row.length === 0 || side <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  const sum = row.reduce((value, item) => value + item.area, 0);
  const min = Math.min(...row.map((item) => item.area));
  const max = Math.max(...row.map((item) => item.area));
  if (sum <= 0 || min <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  const sideSquared = side * side;
  const sumSquared = sum * sum;
  return Math.max((sideSquared * max) / sumSquared, sumSquared / (sideSquared * min));
}

function layoutSquarifiedRow(row: LayoutItem[], bounds: Bounds): Bounds {
  const rowArea = row.reduce((value, item) => value + item.area, 0);
  if (rowArea <= 0 || bounds.width <= 0 || bounds.height <= 0) {
    return bounds;
  }

  if (bounds.width < bounds.height) {
    const rowHeight = Math.min(bounds.height, rowArea / bounds.width);
    let x = bounds.x;
    row.forEach((entry, index) => {
      const itemWidth = index === row.length - 1 ? Math.max(0, bounds.x + bounds.width - x) : Math.max(0, entry.area / rowHeight);
      entry.item.x = x;
      entry.item.y = bounds.y;
      entry.item.width = itemWidth;
      entry.item.height = rowHeight;
      x += itemWidth;
    });
    return {
      x: bounds.x,
      y: bounds.y + rowHeight,
      width: bounds.width,
      height: Math.max(0, bounds.height - rowHeight),
    };
  }

  const rowWidth = Math.min(bounds.width, rowArea / bounds.height);
  let y = bounds.y;
  row.forEach((entry, index) => {
    const itemHeight = index === row.length - 1 ? Math.max(0, bounds.y + bounds.height - y) : Math.max(0, entry.area / rowWidth);
    entry.item.x = bounds.x;
    entry.item.y = y;
    entry.item.width = rowWidth;
    entry.item.height = itemHeight;
    y += itemHeight;
  });
  return {
    x: bounds.x + rowWidth,
    y: bounds.y,
    width: Math.max(0, bounds.width - rowWidth),
    height: bounds.height,
  };
}
