import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  Activity, ArrowLeftRight, Box, Building2, CheckCircle, ChevronDown,
  ChevronRight, Cpu, Database, Download, Edit3, Eye, GitBranch, Globe,
  HardDrive, LayoutDashboard, Link, Loader2, Maximize2, Minus, MousePointer,
  Network, Plus, RefreshCw, Search, Server, Shield, Shrink, X
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { API_URL } from "../config/api";

const API_BASE = `${API_URL}/api/v1`;

/* ─────────────────────────────────────────────
   Color & Icon helpers
   ───────────────────────────────────────────── */

function getNodeColor(type) {
  switch (type) {
    case "Server":             return { fill: "#EFF6FF", stroke: "#3B82F6", text: "#1E40AF", icon: "#2563EB" };
    case "Application":        return { fill: "#F5F3FF", stroke: "#8B5CF6", text: "#5B21B6", icon: "#7C3AED" };
    case "Database":           return { fill: "#ECFDF5", stroke: "#10B981", text: "#065F46", icon: "#059669" };
    case "Network Device":     return { fill: "#ECFEFF", stroke: "#06B6D4", text: "#155E75", icon: "#0891B2" };
    case "Virtual Machine":
    case "Virtualization":     return { fill: "#EEF2FF", stroke: "#6366F1", text: "#3730A3", icon: "#4F46E5" };
    case "Storage":            return { fill: "#FFF7ED", stroke: "#F59E0B", text: "#92400E", icon: "#D97706" };
    case "Cloud Service":      return { fill: "#F0F9FF", stroke: "#0EA5E9", text: "#0C4A6E", icon: "#0284C7" };
    default:                   return { fill: "#F8FAFC", stroke: "#94A3B8", text: "#475569", icon: "#64748B" };
  }
}

function getConnectionColor(relType) {
  switch (relType) {
    case "hosts":
    case "Hosts":              return "#3B82F6";
    case "connects_to":
    case "Connects To":        return "#06B6D4";
    case "depends_on":
    case "Depends On":         return "#F59E0B";
    case "runs_on":
    case "Runs On":            return "#10B981";
    case "uses":
    case "Uses":               return "#8B5CF6";
    case "replicates":
    case "Replicates":         return "#F97316";
    case "backup":
    case "Backup":             return "#6366F1";
    case "network_link":
    case "Network Link":       return "#14B8A6";
    default:                   return "#94A3B8";
  }
}

function getStatusDotColor(status) {
  switch (status) {
    case "Active":      return "#22C55E";
    case "Maintenance": return "#F59E0B";
    case "Retired":     return "#EF4444";
    case "Inactive":    return "#94A3B8";
    default:            return "#94A3B8";
  }
}

function getNodeIcon(type) {
  switch (type) {
    case "Server":             return Server;
    case "Application":        return LayoutDashboard;
    case "Database":           return Database;
    case "Network Device":     return Network;
    case "Virtual Machine":
    case "Virtualization":     return Cpu;
    case "Storage":            return HardDrive;
    case "Cloud Service":      return Globe;
    default:                   return Box;
  }
}

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString("en-US", {
      year: "numeric", month: "short", day: "numeric",
    });
  } catch { return "—"; }
}

/* ─────────────────────────────────────────────
   BranchSelector — searchable dropdown
   ───────────────────────────────────────────── */
function BranchSelector({ branches = [], value, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);

  const selected = value && value !== "All"
    ? branches.find((b) => String(b.branch_id) === String(value))
    : null;

  const filtered = useMemo(() => {
    if (!query.trim()) return branches;
    const q = query.trim().toLowerCase();
    return branches.filter((b) => (b.branch_name || "").toLowerCase().includes(q));
  }, [branches, query]);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    const handler = (e) => {
      if (open && wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-[220px] items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-left text-sm font-bold text-slate-700 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
      >
        <Building2 size={16} className="shrink-0 text-slate-400" />
        <span className="flex-1 truncate">{selected ? selected.branch_name : "All Branches"}</span>
        <ChevronDown size={14} className={`shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-1.5 w-[260px] rounded-2xl border border-slate-200 bg-white shadow-xl">
          <div className="relative border-b border-slate-100 p-2">
            <Search size={14} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search branches..."
              className="w-full rounded-xl border border-slate-100 bg-slate-50 py-2 pl-8 pr-3 text-xs font-bold text-slate-700 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
            />
          </div>
          <div className="max-h-52 overflow-y-auto p-1.5">
            <button
              type="button"
              onClick={() => { onChange("All"); setOpen(false); }}
              className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-bold transition ${
                !selected ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <Building2 size={14} className="shrink-0 text-slate-400" />
              All Branches
            </button>
            {filtered.map((b) => (
              <button
                key={b.branch_id}
                type="button"
                onClick={() => { onChange(String(b.branch_id)); setOpen(false); }}
                className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-bold transition ${
                  String(b.branch_id) === String(value) ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                <Building2 size={14} className="shrink-0 text-slate-400" />
                {b.branch_name}
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-slate-400">No branches match.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
/* ─────────────────────────────────────────────
   Graph layout algorithm — circular grouped layout
   ───────────────────────────────────────────── */
function computeLayout(nodes, edges) {
  if (nodes.length === 0) return nodes;

  // Group by type
  const groups = {};
  nodes.forEach((n) => {
    const t = n.type || "Other";
    if (!groups[t]) groups[t] = [];
    groups[t].push(n);
  });

  const typeKeys = Object.keys(groups);
  const totalGroups = typeKeys.length;

  // Radius per ring increases with group index
  const baseRadius = 180;
  const ringStep = 140;

  // Center of canvas
  const cx = 600;
  const cy = 400;

  let idx = 0;
  typeKeys.forEach((type, gi) => {
    const items = groups[type];
    const count = items.length;
    const ringRadius = baseRadius + gi * ringStep;
    const startAngle = (gi * 0.4) + 0.2;

    items.forEach((node, i) => {
      const angle = startAngle + (i / count) * Math.PI * 2;
      const x = cx + ringRadius * Math.cos(angle);
      const y = cy + ringRadius * Math.sin(angle);
      node.x = x;
      node.y = y;
      node.groupIndex = gi;
      idx++;
    });
  });

  return nodes;
}

/* ─────────────────────────────────────────────
   GraphLegend sub-component
   ───────────────────────────────────────────── */
function GraphLegend({ nodeTypes, connectionTypes }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="mb-3 text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Legend</p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <div>
          <p className="mb-1.5 text-[10px] font-black uppercase tracking-wider text-slate-400">Node Types</p>
          <div className="space-y-1">
            {nodeTypes.map((nt) => {
              const colors = getNodeColor(nt);
              const Icon = getNodeIcon(nt);
              return (
                <div key={nt} className="flex items-center gap-2">
                  <div className="flex h-5 w-5 items-center justify-center rounded" style={{ backgroundColor: colors.fill, border: `1.5px solid ${colors.stroke}` }}>
                    <Icon size={10} style={{ color: colors.icon }} />
                  </div>
                  <span className="text-xs font-semibold text-slate-700">{nt}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-[10px] font-black uppercase tracking-wider text-slate-400">Relationships</p>
          <div className="space-y-1">
            {connectionTypes.map((ct) => (
              <div key={ct} className="flex items-center gap-2">
                <div className="h-0.5 w-4 rounded-full" style={{ backgroundColor: getConnectionColor(ct) }} />
                <span className="text-xs font-semibold text-slate-700">{ct}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-[10px] font-black uppercase tracking-wider text-slate-400">Status</p>
          <div className="space-y-1">
            <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#22C55E" }} /><span className="text-xs font-semibold text-slate-700">Active</span></div>
            <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#F59E0B" }} /><span className="text-xs font-semibold text-slate-700">Maintenance</span></div>
            <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#EF4444" }} /><span className="text-xs font-semibold text-slate-700">Retired</span></div>
            <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#94A3B8" }} /><span className="text-xs font-semibold text-slate-700">Inactive</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   EmptyGraphState sub-component
   ───────────────────────────────────────────── */
function EmptyGraphState() {
  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-white p-12 text-center">
      <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-2xl bg-slate-50">
        <GitBranch size={36} className="text-slate-300" />
      </div>
      <h3 className="text-xl font-black text-slate-900">No Dependency Relationships Found</h3>
      <p className="mt-2 max-w-md text-sm text-slate-500">
        Start creating relationships between Configuration Items to visualize your infrastructure topology.
      </p>
      <button
        type="button"
        className="mt-6 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700"
      >
        <Plus size={16} />
        Create Dependency Relationship
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────────
   CIDetailPanel — right side panel
   ───────────────────────────────────────────── */
function CIDetailPanel({ node, onClose, onViewCI, onEditCI, onOpenImpact }) {
  if (!node) return null;

  const colors = getNodeColor(node.type);
  const Icon = getNodeIcon(node.type);

  const renderField = (label, value) => (
    <div className="flex items-center justify-between border-b border-slate-100 py-2.5">
      <span className="text-xs font-bold text-slate-400">{label}</span>
      <span className="text-xs font-semibold text-slate-700 text-right max-w-[55%] truncate">{value || "—"}</span>
    </div>
  );

  return (
    <div className="h-full overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: colors.fill, border: `1.5px solid ${colors.stroke}` }}>
            <Icon size={18} style={{ color: colors.icon }} />
          </div>
          <div>
            <h3 className="text-sm font-black text-slate-900 leading-tight">{node.name || "Unknown CI"}</h3>
            <span className="text-[11px] font-bold text-slate-400">{node.type || "—"}</span>
          </div>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <X size={16} />
        </button>
      </div>

      {/* CI Info */}
      <div className="px-5 py-4">
        <p className="mb-2 text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">CI Information</p>
        <div className="rounded-xl bg-slate-50 px-4">
          {renderField("Status", node.status)}
          {renderField("Location", node.location)}
          {renderField("Branch", node.branch_name)}
          {renderField("Owner", node.owner)}
          {renderField("OS", node.operating_system)}
          {renderField("IP Address", node.ip_address)}
          {renderField("Environment", node.environment)}
          {renderField("Description", node.description)}
        </div>
      </div>

      {/* Dependencies */}
      <div className="border-t border-slate-100 px-5 py-4">
        <p className="mb-3 text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Dependencies</p>
        <div className="space-y-3">
          <div>
            <p className="mb-1.5 text-xs font-bold text-slate-500 flex items-center gap-1.5">
              <ArrowLeftRight size={12} className="text-blue-500" /> Inbound ({node.inbound?.length || 0})
            </p>
            <div className="space-y-1">
              {(node.inbound?.length > 0 ? node.inbound : [{ name: "None", placeholder: true }]).map((dep, i) => (
                <div key={i} className={`flex items-center gap-2 rounded-lg px-3 py-2 ${dep.placeholder ? "bg-slate-50" : "bg-blue-50/50"}`}>
                  {!dep.placeholder && <Link size={12} className="shrink-0 text-blue-500" />}
                  <span className={`text-xs font-semibold ${dep.placeholder ? "text-slate-400" : "text-slate-700"}`}>
                    {dep.placeholder ? "No inbound dependencies" : dep.name || dep}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-bold text-slate-500 flex items-center gap-1.5">
              <ArrowLeftRight size={12} className="text-amber-500" /> Outbound ({node.outbound?.length || 0})
            </p>
            <div className="space-y-1">
              {(node.outbound?.length > 0 ? node.outbound : [{ name: "None", placeholder: true }]).map((dep, i) => (
                <div key={i} className={`flex items-center gap-2 rounded-lg px-3 py-2 ${dep.placeholder ? "bg-slate-50" : "bg-amber-50/50"}`}>
                  {!dep.placeholder && <Link size={12} className="shrink-0 text-amber-500" />}
                  <span className={`text-xs font-semibold ${dep.placeholder ? "text-slate-400" : "text-slate-700"}`}>
                    {dep.placeholder ? "No outbound dependencies" : dep.name || dep}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Health Summary */}
      <div className="border-t border-slate-100 px-5 py-4">
        <p className="mb-3 text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Health Summary</p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "Availability", value: "98.5%", color: "text-emerald-600" },
            { label: "CPU Usage", value: node.type === "Server" ? "42%" : "—", color: node.type === "Server" ? "text-amber-600" : "text-slate-400" },
            { label: "Memory Usage", value: node.type === "Server" ? "67%" : "—", color: node.type === "Server" ? "text-amber-600" : "text-slate-400" },
            { label: "Network", value: "Online", color: node.status === "Active" ? "text-emerald-600" : "text-slate-400" },
          ].map((h) => (
            <div key={h.label} className="rounded-xl border border-slate-100 bg-white p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{h.label}</p>
              <p className={`mt-1 text-sm font-black ${h.color}`}>{h.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Action buttons */}
      <div className="border-t border-slate-100 px-5 py-4">
        <p className="mb-3 text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Actions</p>
        <div className="space-y-2">
          <button type="button" onClick={() => onViewCI?.(node)}
            className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50">
            <Eye size={14} /> View CI Details
          </button>
          <button type="button" onClick={() => onEditCI?.(node)}
            className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50">
            <Edit3 size={14} /> Edit CI
          </button>
          <button type="button" onClick={() => onOpenImpact?.(node)}
            className="flex w-full items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-xs font-bold text-blue-700 transition hover:bg-blue-100">
            <Activity size={14} /> Open Change Impact Analysis
          </button>
          <button type="button"
            className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50">
            <Download size={14} /> Export Dependency
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   SVG Dependency Graph
   ───────────────────────────────────────────── */
const SVGGraph = forwardRef(function SVGGraph({
  graphNodes, graphEdges, selectedId, hoveredId, onSelect, onHover, onDoubleClick,
  dimmed, tooltip, tooltipPos, searchQuery,
}, ref) {
  const svgRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [nodePositions, setNodePositions] = useState({});
  const [draggingNode, setDraggingNode] = useState(null);

  // Expose control methods to parent
  useImperativeHandle(ref, () => ({
    zoomIn: () => setZoom((z) => Math.min(z + 0.15, 3)),
    zoomOut: () => setZoom((z) => Math.max(z - 0.15, 0.2)),
    fitToScreen: () => {
      const vals = Object.values(nodePositions);
      if (vals.length === 0) return;
      const minX = Math.min(...vals.map((v) => v.x)) - 100;
      const maxX = Math.max(...vals.map((v) => v.x)) + 100;
      const minY = Math.min(...vals.map((v) => v.y)) - 100;
      const maxY = Math.max(...vals.map((v) => v.y)) + 100;
      const bw = maxX - minX;
      const bh = maxY - minY;
      const scale = Math.min(900 / bw, 600 / bh, 1.5);
      setZoom(scale);
      setPan({ x: -minX * scale + 50, y: -minY * scale + 50 });
    },
    resetView: () => { setZoom(1); setPan({ x: 0, y: 0 }); },
  }), [nodePositions]);

  // Initialize positions from layout
  useEffect(() => {
    const pos = {};
    graphNodes.forEach((n) => { pos[n.id] = { x: n.x || 0, y: n.y || 0 }; });
    setNodePositions(pos);
  }, [graphNodes]);

  // Pan handlers
  const handleMouseDown = useCallback((e) => {
    if (e.target === svgRef.current || (e.target.closest("svg") && !e.target.closest(".graph-node"))) {
      setDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  }, [pan]);

  const handleMouseMove = useCallback((e) => {
    if (dragging && !draggingNode) {
      setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
    }
    if (draggingNode) {
      setNodePositions((prev) => ({
        ...prev,
        [draggingNode]: { x: (e.clientX - pan.x) / zoom, y: (e.clientY - pan.y) / zoom }
      }));
    }
  }, [dragging, draggingNode, dragStart, pan, zoom]);

  const handleMouseUp = useCallback(() => {
    setDragging(false);
    setDraggingNode(null);
  }, []);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    setZoom((z) => Math.max(0.2, Math.min(3, z + (e.deltaY > 0 ? -0.08 : 0.08))));
  }, []);

  const handleNodeMouseDown = useCallback((e, nodeId) => {
    e.stopPropagation();
    setDraggingNode(nodeId);
    setDragStart({ x: e.clientX, y: e.clientY });
  }, []);

  const handleNodeClick = useCallback((e, node) => {
    e.stopPropagation();
    onSelect(node);
  }, [onSelect]);

  const handleNodeDoubleClick = useCallback((e, node) => {
    e.stopPropagation();
    onDoubleClick?.(node);
    const pos = nodePositions[node.id];
    if (pos) {
      setPan({ x: 500 - pos.x * zoom, y: 300 - pos.y * zoom });
    }
  }, [onDoubleClick, nodePositions, zoom]);

  const getEdgePath = (source, target) => {
    const s = nodePositions[source];
    const t = nodePositions[target];
    if (!s || !t) return "";
    const dx = t.x - s.x;
    const dy = t.y - s.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = -dy / dist * 30;
    const ny = dx / dist * 30;
    const cx = (s.x + t.x) / 2 + nx;
    const cy = (s.y + t.y) / 2 + ny;
    return `M ${s.x} ${s.y} Q ${cx} ${cy} ${t.x} ${t.y}`;
  };

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl border border-slate-200 bg-white" style={{ minHeight: 500 }}>
      <svg
        ref={svgRef}
        className="h-full w-full cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        <defs>
          {graphEdges.map((edge, idx) => {
            if (!nodePositions[edge.source] || !nodePositions[edge.target]) return null;
            return <path key={`ep-${idx}`} id={`edge-path-${idx}`} d={getEdgePath(edge.source, edge.target)} />;
          })}
        </defs>

        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {/* Edges */}
          {graphEdges.map((edge, idx) => {
            if (!nodePositions[edge.source] || !nodePositions[edge.target]) return null;
            const path = getEdgePath(edge.source, edge.target);
            const isHL = selectedId && (selectedId === edge.source || selectedId === edge.target);
            const dim = dimmed && !isHL;
            const color = getConnectionColor(edge.type);
            return (
              <g key={`edge-${idx}`}>
                <path d={path} fill="none" stroke={dim ? "#E2E8F0" : color} strokeWidth={dim ? 1 : 2} strokeLinecap="round" opacity={dim ? 0.25 : 0.8} />
                <path d={path} fill="none" stroke="transparent" strokeWidth={14} className="cursor-pointer" />
                {!dim && <circle cx={(nodePositions[edge.source].x + nodePositions[edge.target].x) / 2} cy={(nodePositions[edge.source].y + nodePositions[edge.target].y) / 2} r={3} fill={color} />}
              </g>
            );
          })}

          {/* Edge labels */}
          {graphEdges.map((edge, idx) => {
            if (!nodePositions[edge.source] || !nodePositions[edge.target]) return null;
            const isHL = selectedId && (selectedId === edge.source || selectedId === edge.target);
            if (dimmed && !isHL) return null;
            return (
              <text key={`el-${idx}`} fontSize="8" fontWeight="700" fill={getConnectionColor(edge.type)} opacity={0.7}>
                <textPath href={`#edge-path-${idx}`} startOffset="50%" textAnchor="middle">{edge.type}</textPath>
              </text>
            );
          })}

          {/* Nodes */}
          {graphNodes.map((node) => {
            const pos = nodePositions[node.id] || { x: node.x || 0, y: node.y || 0 };
            const colors = getNodeColor(node.type);
            const isSelected = selectedId === node.id;
            const isHovered = hoveredId === node.id;

            let nodeDimmed = false;
            if (dimmed && selectedId && selectedId !== node.id) {
              nodeDimmed = !graphEdges.some(
                (e) => (e.source === selectedId && e.target === node.id) || (e.target === selectedId && e.source === node.id)
              );
            }

            const isSearched = searchQuery && node.name?.toLowerCase().includes(searchQuery.toLowerCase());
            const NodeIcon = getNodeIcon(node.type);

            return (
              <g key={node.id} className="graph-node" style={{ cursor: "pointer", opacity: nodeDimmed ? 0.2 : isSearched || !dimmed ? 1 : 0.4 }}
                onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                onClick={(e) => handleNodeClick(e, node)}
                onDoubleClick={(e) => handleNodeDoubleClick(e, node)}
                onMouseEnter={() => onHover({ id: node.id, name: node.name, type: node.type, status: node.status || "Active", x: pos.x, y: pos.y })}
                onMouseLeave={() => onHover(null)}
              >
                {(isSelected || isHovered) && (
                  <circle cx={pos.x} cy={pos.y} r={48} fill={colors.fill} stroke={colors.stroke} strokeWidth={2.5} opacity={0.3} />
                )}
                <foreignObject x={pos.x - 42} y={pos.y - 32} width={84} height={64} style={{ overflow: "visible" }}>
                  <div className="flex flex-col items-center justify-center rounded-xl border-2 bg-white px-2 py-2 shadow-md transition-all duration-200 hover:shadow-lg"
                    style={{ borderColor: nodeDimmed ? "#E2E8F0" : colors.stroke, boxShadow: isSelected ? `0 4px 16px ${colors.stroke}40` : undefined }}
                  >
                    <div className="flex items-center gap-1.5">
                      <div className="flex h-6 w-6 items-center justify-center rounded-lg" style={{ backgroundColor: colors.fill }}>
                        <NodeIcon size={14} style={{ color: colors.icon }} />
                      </div>
                      <span className="h-2 w-2 rounded-full border border-white" style={{ backgroundColor: getStatusDotColor(node.status) }} />
                    </div>
                    <span className="mt-1 max-w-[72px] truncate text-[10px] font-black text-slate-800 leading-tight text-center">{node.name}</span>
                    <span className="text-[8px] font-semibold text-slate-400 leading-tight">{node.type}</span>
                  </div>
                </foreignObject>
              </g>
            );
          })}
        </g>
      </svg>

      {/* Hover tooltip */}
      {tooltip && tooltipPos && (
        <div className="pointer-events-none absolute z-50 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-lg"
          style={{ left: tooltipPos.x + 15, top: tooltipPos.y - 10 }}>
          <p className="text-xs font-black text-slate-900">{tooltip.name}</p>
          <p className="text-[10px] font-semibold text-slate-500">{tooltip.type} · {tooltip.status}</p>
        </div>
      )}

      {/* Zoom level indicator */}
      <div className="absolute bottom-4 left-4 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-500 shadow-sm">
        {Math.round(zoom * 100)}%
      </div>
    </div>
  );
});

/* ─────────────────────────────────────────────
   DependencyToolbar
   ───────────────────────────────────────────── */
function DependencyToolbar({ layoutMode, onLayoutChange, search, onSearchChange, onZoomIn, onZoomOut, onFit, onReset, onRefresh, loading }) {
  const [searchFocused, setSearchFocused] = useState(false);

  const LAYOUT_OPTIONS = [
    { value: "auto", label: "Auto" },
    { value: "hierarchical", label: "Hierarchical" },
    { value: "horizontal", label: "Horizontal" },
    { value: "vertical", label: "Vertical" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      {/* Layout dropdown */}
      <div className="relative">
        <select
          value={layoutMode}
          onChange={(e) => onLayoutChange(e.target.value)}
          className="appearance-none rounded-xl border border-slate-200 bg-white px-3 py-2 pr-8 text-xs font-bold text-slate-700 outline-none transition hover:border-blue-200 focus:border-blue-500 focus:ring-4 focus:ring-blue-600/10"
        >
          {LAYOUT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <ChevronDown size={12} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
      </div>

      <div className="h-5 w-px bg-slate-200" />

      {/* Search */}
      <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 transition flex-1 min-w-[160px] max-w-[260px] ${
        searchFocused ? "border-blue-500 ring-4 ring-blue-600/10" : "border-slate-200"
      }`}>
        <Search size={14} className="shrink-0 text-slate-400" />
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          placeholder="Search CI..."
          className="w-full bg-transparent text-xs font-bold text-slate-700 outline-none placeholder:text-slate-400"
        />
        {search && (
          <button type="button" onClick={() => onSearchChange("")} className="shrink-0 text-slate-400 hover:text-slate-600">
            <X size={14} />
          </button>
        )}
      </div>

      <div className="h-5 w-px bg-slate-200" />

      {/* Zoom controls */}
      <div className="flex items-center gap-1">
        <button type="button" onClick={onZoomIn}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50">
          <Plus size={14} />
        </button>
        <button type="button" onClick={onZoomOut}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50">
          <Minus size={14} />
        </button>
      </div>

      <div className="h-5 w-px bg-slate-200" />

      {/* View controls */}
      <div className="flex items-center gap-1">
        <button type="button" onClick={onFit}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-50">
          <Maximize2 size={13} /> Fit
        </button>
        <button type="button" onClick={onReset}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-50">
          <Shrink size={13} /> Reset
        </button>
        <button type="button" onClick={onRefresh} disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Main DependencyGraphView export
   ───────────────────────────────────────────── */
export default function DependencyGraphView({ user, role, branches }) {
  const isSuperAdmin = role === "SuperAdmin";
  const [dependencies, setDependencies] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterBranch, setFilterBranch] = useState(isSuperAdmin ? "All" : String(user?.branch_id || ""));
  const [selectedNode, setSelectedNode] = useState(null);
  const [hoveredNodeId, setHoveredNodeId] = useState(null);
  const [tooltip, setTooltip] = useState(null);
  const [tooltipPos, setTooltipPos] = useState(null);
  const [layoutMode, setLayoutMode] = useState("auto");
  const [searchQuery, setSearchQuery] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);
  const graphRef = useRef(null);

  const fetchDependencies = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        current_user_id: user?.user_id || "",
        role_name: role || "",
        branch_id: user?.branch_id || "",
      });
      if (filterBranch && filterBranch !== "All") params.set("branch_id", filterBranch);
      const res = await fetch(`${API_BASE}/cmdb/dependencies?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unable to fetch dependencies");
      setDependencies(Array.isArray(data) ? data : []);
      setLastUpdated(new Date().toISOString());
    } catch (err) {
      console.error("Fetch dependencies failed:", err);
      setDependencies([]);
    } finally {
      setLoading(false);
    }
  }, [user, role, filterBranch]);

  useEffect(() => {
    fetchDependencies();
  }, [fetchDependencies]);

  // Build graph nodes and edges from dependencies
  const { graphNodes, graphEdges, totalRelationships, totalConnectedCIs, nodeTypes, connectionTypes } = useMemo(() => {
    const nodeMap = {};
    const edges = [];
    const typesSet = new Set();
    const connTypesSet = new Set();

    dependencies.forEach((dep) => {
      // Source node
      const srcId = `ci-${dep.source_ci_id}`;
      if (!nodeMap[srcId]) {
        nodeMap[srcId] = {
          id: srcId,
          ci_id: dep.source_ci_id,
          name: dep.source_name,
          type: dep.source_type,
          branch_name: dep.source_branch_name,
          branch_id: dep.source_branch_id,
          inbound: [],
          outbound: [],
        };
        typesSet.add(dep.source_type);
      }

      // Target node
      const tgtId = `ci-${dep.target_ci_id}`;
      if (!nodeMap[tgtId]) {
        nodeMap[tgtId] = {
          id: tgtId,
          ci_id: dep.target_ci_id,
          name: dep.target_name,
          type: dep.target_type,
          branch_name: dep.target_branch_name,
          branch_id: dep.target_branch_id,
          inbound: [],
          outbound: [],
        };
        typesSet.add(dep.target_type);
      }

      // Edge
      edges.push({
        source: srcId,
        target: tgtId,
        type: dep.relationship_type || "Depends On",
        description: dep.dep_description,
      });

      // Track deps for detail panel
      nodeMap[srcId].outbound.push({ name: dep.target_name, type: dep.relationship_type });
      nodeMap[tgtId].inbound.push({ name: dep.source_name, type: dep.relationship_type });

      connTypesSet.add(dep.relationship_type || "Depends On");
    });

    const nodeList = Object.values(nodeMap);

    // Compute layout positions
    computeLayout(nodeList, edges);

    return {
      graphNodes: nodeList,
      graphEdges: edges,
      totalRelationships: dependencies.length,
      totalConnectedCIs: nodeList.length,
      nodeTypes: Array.from(typesSet),
      connectionTypes: Array.from(connTypesSet),
    };
  }, [dependencies]);

  // Selected CI detail enrichment (fetch full CI info)
  const fetchCIDetail = useCallback(async (node) => {
    try {
      const params = new URLSearchParams({
        current_user_id: user?.user_id || "",
        role_name: role || "",
        branch_id: user?.branch_id || "",
      });
      const res = await fetch(`${API_BASE}/cmdb/config-items/${node.ci_id}?${params.toString()}`);
      const data = await res.json();
      if (res.ok && data) {
        // Add inbound/outbound from the node data
        setSelectedNode({ ...data, inbound: node.inbound, outbound: node.outbound, ci_id: node.ci_id, id: node.id });
      } else {
        setSelectedNode(node);
      }
    } catch {
      setSelectedNode(node);
    }
  }, [user, role]);

  const handleSelectNode = useCallback((node) => {
    fetchCIDetail(node);
  }, [fetchCIDetail]);

  const handleClosePanel = useCallback(() => setSelectedNode(null), []);

  const handleHoverNode = useCallback((hoverData) => {
    if (hoverData) {
      setHoveredNodeId(hoverData.id);
      setTooltip({ name: hoverData.name, type: hoverData.type, status: hoverData.status });
      setTooltipPos({ x: hoverData.x, y: hoverData.y });
    } else {
      setHoveredNodeId(null);
      setTooltip(null);
      setTooltipPos(null);
    }
  }, []);

  const handleDoubleClick = useCallback((node) => {
    fetchCIDetail(node);
  }, [fetchCIDetail]);

  // Determine dimmed state
  const dimmed = useMemo(() => {
    if (!selectedNode && !hoveredNodeId) return false;
    return true;
  }, [selectedNode, hoveredNodeId]);

  const empty = !loading && graphNodes.length === 0;

  return (
    <div className="space-y-5">
      {/* Hero Header */}
      <section className="astrea-page-hero relative overflow-hidden rounded-[28px] border border-white/15 px-7 py-8 text-white shadow-[var(--astrea-hero-shadow)] lg:px-10 lg:py-10">
        <div className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full border-[34px] border-cyan-200/10" />
        <div className="pointer-events-none absolute bottom-[-110px] right-24 h-56 w-56 rounded-full bg-cyan-300/10 blur-2xl" />
        <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-3xl">
            <div className="mt-4 flex flex-wrap gap-4">
              <div>
                <p className="text-2xl font-black text-white">{totalRelationships}</p>
                <p className="text-xs text-cyan-100">Total Relationships</p>
              </div>
              <div className="w-px bg-white/20" />
              <div>
                <p className="text-2xl font-black text-white">{totalConnectedCIs}</p>
                <p className="text-xs text-cyan-100">Connected CIs</p>
              </div>
              <div className="w-px bg-white/20" />
              <div>
                <p className="text-sm font-black text-white mt-1.5">{lastUpdated ? formatDate(lastUpdated) : "—"}</p>
                <p className="text-xs text-cyan-100">Last Updated</p>
              </div>
            </div>
          </div>
          {isSuperAdmin && (
            <BranchSelector
              branches={branches}
              value={filterBranch}
              onChange={(val) => { setFilterBranch(val); setSelectedNode(null); }}
            />
          )}
        </div>
      </section>

      {/* Toolbar */}
      <DependencyToolbar
        layoutMode={layoutMode}
        onLayoutChange={(v) => setLayoutMode(v)}
        search={searchQuery}
        onZoomIn={() => graphRef.current?.zoomIn?.()}
        onZoomOut={() => graphRef.current?.zoomOut?.()}
        onFit={() => graphRef.current?.fitToScreen?.()}
        onReset={() => graphRef.current?.resetView?.()}
        loading={loading}
      />

      {/* Loading state */}
      {loading && (
        <div className="flex min-h-[400px] items-center justify-center rounded-2xl border border-slate-200 bg-white">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading dependency graph...
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && empty && <EmptyGraphState />}

      {/* Main content: graph + detail panel */}
      {!loading && !empty && (
        <div className="flex flex-col gap-5 lg:flex-row">
          {/* Graph (75%) */}
          <div className="lg:w-[75%]">
            <SVGGraph
              graphNodes={graphNodes}
              graphEdges={graphEdges}
              selectedId={selectedNode?.id}
              hoveredId={hoveredNodeId}
              onSelect={handleSelectNode}
              onHover={handleHoverNode}
              onDoubleClick={handleDoubleClick}
              dimmed={dimmed}
              ref={graphRef}
              tooltip={tooltip}
              tooltipPos={tooltipPos}
              searchQuery={searchQuery}
            />
          </div>

          {/* Detail panel (25%) */}
          <div className="lg:w-[25%] lg:min-w-[280px]">
            {selectedNode ? (
              <CIDetailPanel
                node={selectedNode}
                onClose={handleClosePanel}
                onViewCI={(n) => { /* navigate to CI details */ }}
                onEditCI={(n) => { /* open edit CI modal */ }}
                onOpenImpact={(n) => { /* navigate to change impact */ }}
              />
            ) : (
              <div className="flex h-full min-h-[300px] flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-8 text-center">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-50">
                  <MousePointer size={22} className="text-slate-300" />
                </div>
                <p className="text-sm font-bold text-slate-900">Select a CI Node</p>
                <p className="mt-1 text-xs text-slate-500">Click on any CI in the graph to view details and dependencies.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Legend */}
      {!loading && !empty && (
        <GraphLegend nodeTypes={nodeTypes} connectionTypes={connectionTypes} />
      )}
    </div>
  );
}
