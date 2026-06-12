import { type MouseEvent, type PointerEvent, type WheelEvent, useMemo, useRef, useState } from "react";

import { shortName } from "../format";
import { useElementSize } from "../hooks/useElementSize";
import type { DependencyEdge, DependencyGraph } from "../types/analysis";

interface DependencyGraphViewProps {
  graph: DependencyGraph;
  selectedModule: string | null;
  overview: boolean;
  onSelect: (moduleName: string) => void;
  onOpen: (moduleName: string) => void;
  onEdgeOpen: (edge: DependencyEdge) => void;
}

interface DisplayNode {
  name: string;
  dependedByCount: number;
  dependsOnCount: number;
  degree: number;
  x: number;
  y: number;
  radius: number;
}

interface DisplayEdge {
  source: DisplayNode;
  target: DisplayNode;
  count: number;
  symbols: string[];
}

interface PanOffset {
  x: number;
  y: number;
}

interface DragState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startPan: PanOffset;
  moved: boolean;
}

const fallbackWidth = 960;
const fallbackHeight = 560;
const minZoom = 0.45;
const maxZoom = 3.2;
const colors = ["#e84a53", "#4170cd", "#67be5a", "#f4b836", "#4ab2d1", "#9367cd", "#e67e30", "#3aa887", "#dc5c9b", "#84b848"];

export function DependencyGraphView({ graph, selectedModule, overview, onSelect, onOpen, onEdgeOpen }: DependencyGraphViewProps) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<PanOffset>({ x: 0, y: 0 });
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const viewportSize = useElementSize(viewportRef);
  const canvasWidth = Math.max(1, viewportSize.width || fallbackWidth);
  const canvasHeight = Math.max(1, viewportSize.height || fallbackHeight);
  const display = useMemo(
    () => buildDisplayGraph(graph, selectedModule, overview, canvasWidth, canvasHeight, zoom),
    [graph, selectedModule, overview, canvasWidth, canvasHeight, zoom],
  );

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setZoom((value) => clampZoom(value * Math.exp(-event.deltaY * 0.001)));
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }
    const nextDrag = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPan: pan,
      moved: false,
    };
    dragRef.current = nextDrag;
    suppressClickRef.current = false;
    setDrag(nextDrag);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const currentDrag = dragRef.current;
    if (!currentDrag || currentDrag.pointerId !== event.pointerId) {
      return;
    }
    const dx = event.clientX - currentDrag.startClientX;
    const dy = event.clientY - currentDrag.startClientY;
    const moved = currentDrag.moved || Math.abs(dx) + Math.abs(dy) > 3;
    setPan({ x: currentDrag.startPan.x + dx, y: currentDrag.startPan.y + dy });
    if (moved !== currentDrag.moved) {
      const nextDrag = { ...currentDrag, moved };
      dragRef.current = nextDrag;
      suppressClickRef.current = true;
      setDrag(nextDrag);
    }
  }

  function handlePointerEnd(event: PointerEvent<HTMLDivElement>) {
    const currentDrag = dragRef.current;
    if (!currentDrag || currentDrag.pointerId !== event.pointerId) {
      return;
    }
    suppressClickRef.current = currentDrag.moved;
    dragRef.current = null;
    setDrag(null);
  }

  function handleNodeClick(event: MouseEvent<SVGGElement>, name: string) {
    event.stopPropagation();
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onSelect(name);
  }

  function handleNodeDoubleClick(event: MouseEvent<SVGGElement>, name: string) {
    event.stopPropagation();
    onOpen(name);
  }

  function handleEdgeClick(event: MouseEvent<SVGGElement>, edge: DisplayEdge) {
    event.stopPropagation();
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onEdgeOpen({
      source: edge.source.name,
      target: edge.target.name,
      count: edge.count,
      symbols: edge.symbols,
    });
  }

  if (display.nodes.length === 0) {
    return <div className="empty-state">{overview ? "没有可显示的依赖总览" : "选择模块后显示依赖关系"}</div>;
  }

  return (
    <div className="graph-shell">
      <div
        ref={viewportRef}
        className={`graph-viewport ${drag ? "dragging" : ""}`}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
      >
        <svg
          className="dependency-graph"
          viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
          role="img"
          aria-label="模块依赖图"
        >
          <g transform={`translate(${pan.x} ${pan.y})`}>
            {display.edges.map((edge, index) => {
              const start = boundary(edge.source, edge.target);
              const end = boundary(edge.target, edge.source);
              const lineColor = colorFor(edge.source.name);
              const active = selectedModule === edge.source.name || selectedModule === edge.target.name;
              const opacity = active ? 0.92 : 0.18;
              const strokeWidth = active ? 2.4 : 0.9;
              return (
                <g
                  key={`${edge.source.name}-${edge.target.name}-${index}`}
                  className={`graph-edge ${active ? "active" : ""}`}
                  onClick={(event) => handleEdgeClick(event, edge)}
                >
                  <line className="graph-edge-hit" x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
                  <line
                    x1={start.x}
                    y1={start.y}
                    x2={end.x}
                    y2={end.y}
                    stroke={lineColor}
                    strokeOpacity={opacity}
                    strokeWidth={strokeWidth}
                  />
                  <polygon points={arrowHead(end, start, active ? 10 : 8)} fill={lineColor} fillOpacity={opacity} />
                  <GraphEdgeLabel start={start} end={end} count={edge.count} color={lineColor} active={active} />
                </g>
              );
            })}
            {display.nodes.map((node) => {
              const selected = node.name === selectedModule;
              return (
                <g
                  key={node.name}
                  className="graph-node"
                  onClick={(event) => handleNodeClick(event, node.name)}
                  onDoubleClick={(event) => handleNodeDoubleClick(event, node.name)}
                >
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={selected ? node.radius + 4 : node.radius}
                    fill={colorFor(node.name)}
                    fillOpacity={selected ? 1 : 0.88}
                    stroke={selected ? "#1f2937" : "#fff"}
                    strokeWidth={selected ? 3 : 1}
                  />
                  <text x={node.x + node.radius + 6} y={node.y + 4} fill={selected ? "#111827" : "#344054"} fontSize={display.nodes.length > 90 ? 11 : 12}>
                    {shortName(node.name)}
                  </text>
                  <title>
                    {node.name}
                    {"\n"}被引用 {node.dependedByCount} | 依赖 {node.dependsOnCount}
                  </title>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
}

function clampZoom(value: number): number {
  return Math.min(maxZoom, Math.max(minZoom, value));
}

function buildDisplayGraph(graph: DependencyGraph, selectedModule: string | null, overview: boolean, width: number, height: number, spacing: number) {
  const names = overview
    ? graph.moduleNames
        .slice()
        .sort((a, b) => degree(graph, b) - degree(graph, a) || a.localeCompare(b))
    : selectedModule
      ? relatedNames(graph, selectedModule)
      : [];
  const nodes = new Map<string, DisplayNode>();
  names.forEach((name, index) =>
    nodes.set(name, createNode(graph, name, index, names.length, !overview && name === selectedModule, width, height, spacing)),
  );
  const edges: DisplayEdge[] = [];
  const included = new Set(nodes.keys());
  const sourceEdges = overview ? graph.edges.slice().sort((a, b) => b.count - a.count).slice(0, 1200) : graph.edges;
  for (const edge of sourceEdges) {
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (!source || !target || !included.has(edge.source) || !included.has(edge.target)) {
      continue;
    }
    edges.push({ source, target, count: edge.count, symbols: edge.symbols });
  }
  return { nodes: [...nodes.values()], edges };
}

function GraphEdgeLabel({
  start,
  end,
  count,
  color,
  active,
}: {
  start: { x: number; y: number };
  end: { x: number; y: number };
  count: number;
  color: string;
  active: boolean;
}) {
  if (!active) {
    return null;
  }
  const x = (start.x + end.x) / 2;
  const y = (start.y + end.y) / 2;
  const text = count.toLocaleString();
  const width = Math.max(20, text.length * 6 + 10);
  return (
    <g className="graph-edge-label" transform={`translate(${x} ${y})`}>
      <rect x={-width / 2} y={-8} width={width} height={16} rx={8} fill="#fff" stroke={color} strokeOpacity={0.82} />
      <text x="0" y="3.5" textAnchor="middle" fill={color}>
        {text}
      </text>
    </g>
  );
}

function relatedNames(graph: DependencyGraph, selectedModule: string): string[] {
  const dependency = graph.byModule[selectedModule];
  if (!dependency) {
    return [];
  }
  const names = new Set<string>([selectedModule]);
  topRelations(dependency.dependedBy, 120).forEach(([name]) => names.add(name));
  topRelations(dependency.dependsOn, 120).forEach(([name]) => names.add(name));
  return [...names].sort((a, b) => (a === selectedModule ? -1 : b === selectedModule ? 1 : a.localeCompare(b)));
}

function topRelations(relations: Record<string, number>, limit: number) {
  return Object.entries(relations)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);
}

function createNode(graph: DependencyGraph, name: string, index: number, count: number, fixed: boolean, width: number, height: number, spacing: number): DisplayNode {
  const dependency = graph.byModule[name];
  const dependedByCount = dependency ? Object.keys(dependency.dependedBy).length : 0;
  const dependsOnCount = dependency ? Object.keys(dependency.dependsOn).length : 0;
  const degreeValue = dependedByCount + dependsOnCount;
  if (fixed) {
    return { name, dependedByCount, dependsOnCount, degree: degreeValue, x: width / 2, y: height / 2, radius: radiusFor(degreeValue) };
  }
  const angle = stableUnit(`${name}:angle`) * Math.PI * 2;
  const ring = Math.sqrt((index + 0.35 + stableUnit(`${name}:radius`) * 0.65) / Math.max(1, count));
  const layoutRadius = Math.max(24, Math.min(width, height) / 2 - 80) * spacing;
  return {
    name,
    dependedByCount,
    dependsOnCount,
    degree: degreeValue,
    x: width / 2 + Math.cos(angle) * layoutRadius * Math.min(0.95, Math.max(0.1, ring)),
    y: height / 2 + Math.sin(angle) * layoutRadius * Math.min(0.95, Math.max(0.1, ring)),
    radius: radiusFor(degreeValue),
  };
}

function degree(graph: DependencyGraph, name: string): number {
  const dependency = graph.byModule[name];
  return dependency ? Object.keys(dependency.dependedBy).length + Object.keys(dependency.dependsOn).length : 0;
}

function radiusFor(degreeValue: number): number {
  return Math.min(13, Math.max(5.5, 4.5 + Math.sqrt(Math.max(1, degreeValue)) * 1.15));
}

function boundary(from: DisplayNode, to: DisplayNode) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  return {
    x: from.x + (dx / distance) * from.radius,
    y: from.y + (dy / distance) * from.radius,
  };
}

function arrowHead(tip: { x: number; y: number }, from: { x: number; y: number }, size: number): string {
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  const ux = dx / distance;
  const uy = dy / distance;
  const baseX = tip.x - ux * size;
  const baseY = tip.y - uy * size;
  const halfWidth = size * 0.45;
  const perpX = -uy;
  const perpY = ux;
  return [
    `${tip.x},${tip.y}`,
    `${baseX + perpX * halfWidth},${baseY + perpY * halfWidth}`,
    `${baseX - perpX * halfWidth},${baseY - perpY * halfWidth}`,
  ].join(" ");
}

function colorFor(name: string): string {
  return colors[stableHash(clusterKey(name)) % colors.length];
}

function clusterKey(name: string): string {
  const fileName = shortName(name);
  const index = fileName.search(/[:._-]/);
  return index > 0 ? fileName.slice(0, index) : fileName;
}

function stableUnit(value: string): number {
  return (stableHash(value) % 10000) / 9999;
}

function stableHash(value: string): number {
  let hash = 17;
  for (const char of value.toLowerCase()) {
    hash = (hash * 31 + char.charCodeAt(0)) & 0x7fffffff;
  }
  return hash;
}
