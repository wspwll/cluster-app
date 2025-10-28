import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  CartesianGrid,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
// NEW: import both datasets
import suvPoints from "./data/suv_points.json";
import puPoints from "./data/pu_points.json";

const COLORS = [
  "#1F77B4",
  "#FF7F0E",
  "#2CA02C",
  "#D62728",
  "#9467BD",
  "#8C564B",
  "#E377C2",
  "#7F7F7F",
  "#BCBD22",
  "#17BECF",
  "#F97316",
  "#14B8A6",
  "#A855F7",
  "#22C55E",
  "#3B82F6",
];

function colorForKey(key, allKeys) {
  const keyStr = String(key);
  const idx = allKeys.findIndex((k) => String(k) === keyStr);
  return COLORS[(idx >= 0 ? idx : 0) % COLORS.length];
}

// --- Centroid hotspot for easy clicking when not zoomed ---
function CentroidDot({ cx, cy, payload, onClick }) {
  return (
    <g onClick={() => onClick?.(payload)} style={{ cursor: "pointer" }}>
      <circle
        cx={cx}
        cy={cy}
        r={18}
        fill="rgba(255,84,50,.10)"
        stroke="rgba(255,84,50,.35)"
      />
      <circle cx={cx} cy={cy} r={3} fill="#FF5432" />
      <text
        x={cx}
        y={cy - 12}
        textAnchor="middle"
        fontSize={12}
        fill="#e5e7eb"
        style={{ pointerEvents: "none" }}
      >
        {`C${payload.cluster}`}
      </text>
    </g>
  );
}

// --------- Helpers ---------
function paddedDomain(vals) {
  if (!vals.length) return [0, 1];
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) {
    const eps = Math.abs(min || 1) * 0.05;
    min -= eps;
    max += eps;
  }
  const pad = (max - min) * 0.05;
  return [min - pad, max + pad];
}
const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);
function tweenDomain(from, to, t) {
  const [f0, f1] = from;
  const [t0, t1] = to;
  const e = easeInOutQuad(t);
  return [f0 + (t0 - f0) * e, f1 + (t1 - f1) * e];
}
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------

export default function App() {
  // NEW: which dataset is active
  const [group, setGroup] = useState("SUV"); // "SUV" | "Pickup"

  // NEW: pick the active raw points
  const dataPoints = group === "SUV" ? suvPoints : puPoints;

  // --- validate rows once per dataset ---
  const rows = useMemo(
    () =>
      (dataPoints || []).filter(
        (r) =>
          Number.isFinite(r.emb_x) &&
          Number.isFinite(r.emb_y) &&
          typeof r.model === "string" &&
          r.model.length > 0 &&
          Number.isFinite(r.cluster)
      ),
    [dataPoints]
  );

  // --- models + selection (buttons) ---
  const allModels = useMemo(
    () => Array.from(new Set(rows.map((r) => r.model))).sort(),
    [rows]
  );
  const [selectedModels, setSelectedModels] = useState(allModels);
  const [colorMode, setColorMode] = useState("cluster"); // "cluster" | "model"
  const [zoomCluster, setZoomCluster] = useState(null); // number | null
  const [centerT, setCenterT] = useState(0); // 0..1 collapse factor

  // keep selections in sync with dataset changes
  useEffect(() => {
    setSelectedModels(allModels);
  }, [allModels]);

  // reset zoom / collapse when switching dataset
  useEffect(() => {
    setZoomCluster(null);
    setCenterT(0);
  }, [group]);

  const toggleModel = (m) =>
    setSelectedModels((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]
    );
  const selectAll = () => setSelectedModels(allModels);
  const clearAll = () => setSelectedModels([]);

  // --- filtered by models (base rows, untransformed) ---
  const filtered = useMemo(() => {
    const active = selectedModels?.length ? selectedModels : allModels;
    return rows.filter((r) => active.includes(r.model));
  }, [rows, selectedModels, allModels]);

  // --- clusters present under current model filter ---
  const availableClusters = useMemo(
    () =>
      Array.from(new Set(filtered.map((r) => r.cluster)))
        .filter(Number.isFinite)
        .sort((a, b) => a - b),
    [filtered]
  );

  // if zoomed cluster disappears due to model filtering, reset
  useEffect(() => {
    if (zoomCluster != null && !availableClusters.includes(zoomCluster))
      setZoomCluster(null);
  }, [availableClusters, zoomCluster]);

  // --- base frame for domains (DOES NOT depend on centerT) ---
  const domainBase = useMemo(
    () =>
      zoomCluster == null
        ? filtered
        : filtered.filter((r) => r.cluster === zoomCluster),
    [filtered, zoomCluster]
  );

  // --- grouping key and centroids computed on the PLOT FRAME (see below) ---
  const groupingKey = colorMode === "cluster" ? "cluster" : "model";

  // --- plot frame: which actual points to display before centroid interpolation ---
  const plotFrame = useMemo(
    () =>
      zoomCluster == null
        ? filtered
        : filtered.filter((r) => r.cluster === zoomCluster),
    [filtered, zoomCluster]
  );

  // --- centroids per group (over the plot frame so zoom respects correct groups) ---
  const centroidsByGroup = useMemo(() => {
    const acc = new Map();
    for (const r of plotFrame) {
      const k = colorMode === "cluster" ? r.cluster : String(r.model);
      if (!acc.has(k)) acc.set(k, { sumX: 0, sumY: 0, n: 0 });
      const s = acc.get(k);
      s.sumX += r.emb_x;
      s.sumY += r.emb_y;
      s.n += 1;
    }
    const out = new Map();
    for (const [k, s] of acc.entries())
      out.set(k, { cx: s.sumX / s.n, cy: s.sumY / s.n });
    return out;
  }, [plotFrame, colorMode]);

  // --- apply center collapse (emb → centroid), BUT axes will not change with this ---
  const plotDataCentered = useMemo(() => {
    if (centerT <= 0) return plotFrame;
    const out = new Array(plotFrame.length);
    for (let i = 0; i < plotFrame.length; i++) {
      const r = plotFrame[i];
      const key = colorMode === "cluster" ? r.cluster : String(r.model);
      const c = centroidsByGroup.get(key);
      out[i] = c
        ? {
            ...r,
            emb_x: lerp(r.emb_x, c.cx, centerT),
            emb_y: lerp(r.emb_y, c.cy, centerT),
          }
        : r;
    }
    return out;
  }, [plotFrame, centroidsByGroup, centerT, colorMode]);

  // --- series grouping (based on transformed data for coloring/legend) ---
  const groupKeys = useMemo(() => {
    const g = new Set(plotDataCentered.map((r) => r[groupingKey]));
    let arr = Array.from(g);
    if (colorMode === "cluster")
      arr = arr.filter((k) => Number.isFinite(k)).sort((a, b) => a - b);
    else arr = arr.map(String).sort();
    return arr;
  }, [plotDataCentered, groupingKey, colorMode]);

  const series = useMemo(() => {
    const buckets = new Map();
    for (const r of plotDataCentered) {
      const k = colorMode === "cluster" ? r.cluster : String(r.model);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(r);
    }
    return groupKeys.map((k) => ({ key: k, data: buckets.get(k) || [] }));
  }, [plotDataCentered, groupKeys, colorMode]);

  // --- centroid hotspots (computed on ALL filtered to click before zoom) ---
  const clusterCentroidsForHotspots = useMemo(() => {
    const byCluster = new Map();
    for (const r of filtered) {
      const k = r.cluster;
      if (!byCluster.has(k)) byCluster.set(k, { sumX: 0, sumY: 0, n: 0 });
      const s = byCluster.get(k);
      s.sumX += r.emb_x;
      s.sumY += r.emb_y;
      s.n += 1;
    }
    return Array.from(byCluster.entries()).map(([cluster, s]) => ({
      cluster,
      emb_x: s.sumX / s.n,
      emb_y: s.sumY / s.n,
    }));
  }, [filtered]);

  // --- target domains based on the BASE (domainBase) ONLY (centerT does NOT affect) ---
  const targetX = useMemo(
    () => paddedDomain(domainBase.map((r) => r.emb_x)),
    [domainBase]
  );
  const targetY = useMemo(
    () => paddedDomain(domainBase.map((r) => r.emb_y)),
    [domainBase]
  );

  // --- animated domains (animate on zoom/filter changes, not on centerT changes) ---
  const [animX, setAnimX] = useState(targetX);
  const [animY, setAnimY] = useState(targetY);
  const rafRef = useRef(null);
  const startRef = useRef(0);
  const fromXRef = useRef(targetX);
  const fromYRef = useRef(targetY);

  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const duration = 400;
    startRef.current = performance.now();
    fromXRef.current = animX || targetX;
    fromYRef.current = animY || targetY;

    const step = (now) => {
      const t = Math.min(1, (now - startRef.current) / duration);
      setAnimX(tweenDomain(fromXRef.current, targetX, t));
      setAnimY(tweenDomain(fromYRef.current, targetY, t));
      if (t < 1) rafRef.current = requestAnimationFrame(step);
      else rafRef.current = null;
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetX[0], targetX[1], targetY[0], targetY[1]]);

  return (
    <div
      style={{
        minHeight: "100vh",
        padding: 16,
        fontFamily: "system-ui, sans-serif",
        background: "#0f172a",
        color: "#e5e7eb",
      }}
    >
      <h1 style={{ margin: 0, marginBottom: 12, color: "#FF5432" }}>
        {group === "SUV" ? "SUV" : "Pickup"} UMAP Scatter — Center Focus (axes
        fixed during collapse)
      </h1>

      {/* Controls */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: 16,
          alignItems: "start",
          marginBottom: 12,
        }}
      >
        {/* NEW: Dataset toggle */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ fontWeight: 600 }}>Dataset:</div>
          <button
            onClick={() => setGroup("SUV")}
            style={{
              background: group === "SUV" ? "#FF5432" : "#0b1220",
              color: group === "SUV" ? "white" : "#cbd5e1",
              border:
                group === "SUV" ? "1px solid #FF5432" : "1px solid #334155",
              borderRadius: 8,
              padding: "6px 10px",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            SUVs
          </button>
          <button
            onClick={() => setGroup("Pickup")}
            style={{
              background: group === "Pickup" ? "#FF5432" : "#0b1220",
              color: group === "Pickup" ? "white" : "#cbd5e1",
              border:
                group === "Pickup" ? "1px solid #FF5432" : "1px solid #334155",
              borderRadius: 8,
              padding: "6px 10px",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Pickups
          </button>
        </div>

        {/* Model buttons */}
        <div>
          <div style={{ marginBottom: 8, fontWeight: 600 }}>Models:</div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              maxWidth: 1000,
            }}
          >
            {allModels.map((m) => {
              const active = selectedModels.includes(m);
              return (
                <button
                  key={m}
                  onClick={() => toggleModel(m)}
                  style={{
                    background: active ? "#FF5432" : "#0b1220",
                    color: active ? "white" : "#cbd5e1",
                    border: active ? "1px solid #FF5432" : "1px solid #334155",
                    borderRadius: 8,
                    padding: "6px 10px",
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  {m}
                </button>
              );
            })}
          </div>
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <button
              onClick={selectAll}
              style={{
                background: "#0b1220",
                color: "white",
                border: "1px solid #334155",
                borderRadius: 8,
                padding: "6px 10px",
                cursor: "pointer",
              }}
            >
              Select all
            </button>
            <button
              onClick={clearAll}
              style={{
                background: "#0b1220",
                color: "white",
                border: "1px solid #334155",
                borderRadius: 8,
                padding: "6px 10px",
                cursor: "pointer",
              }}
            >
              Clear
            </button>
          </div>
        </div>

        {/* Color mode + Cluster zoom buttons */}
        <div
          style={{
            display: "flex",
            gap: 16,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <label>
            Color by:&nbsp;
            <select
              value={colorMode}
              onChange={(e) => setColorMode(e.target.value)}
              style={{
                background: "#0b1220",
                color: "white",
                border: "1px solid #334155",
                padding: "6px 10px",
                borderRadius: 8,
              }}
            >
              <option value="cluster">Cluster</option>
              <option value="model">Model</option>
            </select>
          </label>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 600 }}>Cluster zoom:</span>
            <button
              onClick={() => setZoomCluster(null)}
              style={{
                background: zoomCluster == null ? "#FF5432" : "#0b1220",
                color: zoomCluster == null ? "white" : "#cbd5e1",
                border:
                  zoomCluster == null
                    ? "1px solid #FF5432"
                    : "1px solid #334155",
                borderRadius: 8,
                padding: "6px 10px",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              All
            </button>
            {availableClusters.map((k) => {
              const active = zoomCluster === k;
              return (
                <button
                  key={k}
                  onClick={() => setZoomCluster(k)}
                  style={{
                    background: active ? "#FF5432" : "#0b1220",
                    color: active ? "white" : "#cbd5e1",
                    border: active ? "1px solid #FF5432" : "1px solid #334155",
                    borderRadius: 8,
                    padding: "6px 10px",
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  {`C${k}`}
                </button>
              );
            })}
          </div>

          <div style={{ fontSize: 12, opacity: 0.8 }}>
            Showing {plotDataCentered.length.toLocaleString()} points
            {zoomCluster != null ? ` • Zoom: C${zoomCluster}` : ""} • Dataset:{" "}
            {group}
          </div>
        </div>

        {/* Center focus slider */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontWeight: 600, minWidth: 110 }}>Center focus:</div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={centerT}
            onChange={(e) => setCenterT(parseFloat(e.target.value))}
            style={{ width: 260 }}
          />
          <div
            style={{
              width: 50,
              textAlign: "right",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {(centerT * 100).toFixed(0)}%
          </div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>
            {colorMode === "cluster"
              ? "Collapse to cluster centroids"
              : "Collapse to model centroids"}{" "}
            (axes fixed)
          </div>
        </div>
      </div>

      {/* Chart */}
      <div
        style={{
          background: "#111827",
          border: "1px solid #1f2937",
          borderRadius: 12,
          padding: 10,
          height: 500,
        }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
            <CartesianGrid stroke="#1f2937" />
            <XAxis
              type="number"
              dataKey="emb_x"
              name="UMAP 1"
              tick={{ fill: "#cbd5e1", fontSize: 12 }}
              stroke="#334155"
              domain={animX}
            />
            <YAxis
              type="number"
              dataKey="emb_y"
              name="UMAP 2"
              tick={{ fill: "#cbd5e1", fontSize: 12 }}
              stroke="#334155"
              domain={animY}
            />

            <Legend wrapperStyle={{ color: "#e5e7eb" }} />

            {/* Points (centered by centerT, but axes fixed to domainBase) */}
            {series.map(({ key, data }) => (
              <Scatter
                key={String(key)}
                name={colorMode === "cluster" ? `C${key}` : key}
                data={data}
                fill={colorForKey(key, groupKeys)}
                isAnimationActive={false}
                onClick={(pt) => {
                  const k = pt?.payload?.cluster;
                  if (Number.isFinite(k)) setZoomCluster(k);
                }}
              />
            ))}

            {/* Centroid hotspots (only when not zoomed) */}
            {zoomCluster == null && (
              <Scatter
                data={clusterCentroidsForHotspots}
                name=""
                legendType="none"
                isAnimationActive={false}
                shape={(props) => (
                  <CentroidDot
                    {...props}
                    onClick={(p) => {
                      if (Number.isFinite(p?.cluster))
                        setZoomCluster(p.cluster);
                    }}
                  />
                )}
              />
            )}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
