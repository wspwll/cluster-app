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
import suvPoints from "./data/suv_points.json";
import puPoints from "./data/pu_points.json";
import demosMapping from "./data/demos-mapping.json";

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

export default function App() {
  const [group, setGroup] = useState("SUV"); // "SUV" | "Pickup"
  const dataPoints = group === "SUV" ? suvPoints : puPoints;

  // ---------- NORMALIZE ROWS (adds a .model field; coerces numerics) ----------
  const rows = useMemo(() => {
    const out = [];
    for (const r of dataPoints || []) {
      // accept either `model` or `BLD_DESC_RV_MODEL` (and a couple of common alternates)
      const modelVal =
        r?.model ??
        r?.BLD_DESC_RV_MODEL ??
        r?.Model ??
        r?.model_name ??
        r?.MODEL ??
        null;

      // coerce numerics (some exports come as strings)
      const x = Number(r?.emb_x);
      const y = Number(r?.emb_y);
      const cl = Number(r?.cluster);

      if (
        !modelVal ||
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        !Number.isFinite(cl)
      ) {
        continue; // skip invalid row
      }

      out.push({
        ...r,
        model: String(modelVal),
        emb_x: x,
        emb_y: y,
        cluster: cl,
      });
    }
    return out;
  }, [dataPoints]);

  const allModels = useMemo(
    () => Array.from(new Set(rows.map((r) => r.model))).sort(),
    [rows]
  );
  const [selectedModels, setSelectedModels] = useState(allModels);
  const [colorMode, setColorMode] = useState("cluster"); // "cluster" | "model"
  const [zoomCluster, setZoomCluster] = useState(null); // number | null
  const [centerT, setCenterT] = useState(0); // 0..1 collapse

  useEffect(() => {
    setSelectedModels(allModels);
  }, [allModels]);

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

  const filtered = useMemo(() => {
    const active = selectedModels?.length ? selectedModels : allModels;
    return rows.filter((r) => active.includes(r.model));
  }, [rows, selectedModels, allModels]);

  const availableClusters = useMemo(
    () =>
      Array.from(new Set(filtered.map((r) => r.cluster)))
        .filter(Number.isFinite)
        .sort((a, b) => a - b),
    [filtered]
  );

  useEffect(() => {
    if (zoomCluster != null && !availableClusters.includes(zoomCluster))
      setZoomCluster(null);
  }, [availableClusters, zoomCluster]);

  const domainBase = useMemo(
    () =>
      zoomCluster == null
        ? filtered
        : filtered.filter((r) => r.cluster === zoomCluster),
    [filtered, zoomCluster]
  );

  const groupingKey = colorMode === "cluster" ? "cluster" : "model";

  const plotFrame = useMemo(
    () =>
      zoomCluster == null
        ? filtered
        : filtered.filter((r) => r.cluster === zoomCluster),
    [filtered, zoomCluster]
  );

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

  const targetX = useMemo(
    () => paddedDomain(domainBase.map((r) => r.emb_x)),
    [domainBase]
  );
  const targetY = useMemo(
    () => paddedDomain(domainBase.map((r) => r.emb_y)),
    [domainBase]
  );

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

  // -------------------- DEMOGRAPHICS --------------------
  // Build NAME -> (START -> LABEL) map
  const demoLookups = useMemo(() => {
    const byField = new Map();
    for (const row of demosMapping || []) {
      const field = String(row?.NAME ?? "").trim();
      if (!field) continue;
      const start = row?.START;
      const label = String(row?.LABEL ?? "").trim();
      if (!byField.has(field)) byField.set(field, new Map());
      const m = byField.get(field);
      m.set(start, label);
      m.set(String(start), label);
      if (Number.isFinite(Number(start))) m.set(Number(start), label);
    }
    return byField;
  }, []);

  const scopeRows = useMemo(() => {
    const base =
      zoomCluster == null
        ? filtered
        : filtered.filter((r) => r.cluster === zoomCluster);
    return base;
  }, [filtered, zoomCluster]);

  const demoSummary = useMemo(() => {
    const sections = [];

    for (const [field, codeMap] of demoLookups.entries()) {
      const counts = new Map();
      let validCount = 0;
      let missingCount = 0;

      for (const r of scopeRows) {
        const rawVal = r?.[field];
        if (
          rawVal === undefined ||
          rawVal === null ||
          String(rawVal).trim() === ""
        ) {
          missingCount++;
          continue;
        }

        // Map code → label
        let label = String(rawVal).trim();
        if (codeMap.has(rawVal)) {
          label = codeMap.get(rawVal);
        } else if (codeMap.has(String(rawVal))) {
          label = codeMap.get(String(rawVal));
        } else if (codeMap.has(Number(rawVal))) {
          label = codeMap.get(Number(rawVal));
        } else {
          const asNum = Number(label);
          if (Number.isFinite(asNum) && codeMap.has(asNum))
            label = codeMap.get(asNum);
          else if (codeMap.has(String(asNum)))
            label = codeMap.get(String(asNum));
        }

        counts.set(label, (counts.get(label) || 0) + 1);
        validCount++;
      }

      // If no values at all, skip this demographic
      if (validCount + missingCount === 0) continue;

      // Compute valid percentages first
      const fieldTotal = validCount + missingCount;
      const items = Array.from(counts.entries())
        .map(([label, count]) => ({
          label,
          count,
          pct: (count / fieldTotal) * 100,
        }))
        .sort((a, b) => b.count - a.count);

      // Add the "Unknown" group for missing responses
      if (missingCount > 0) {
        items.push({
          label: "Unknown",
          count: missingCount,
          pct: (missingCount / fieldTotal) * 100,
        });
      }

      // Ensure totals = 100% (minor rounding safeguard)
      const sumPct = items.reduce((a, b) => a + b.pct, 0);
      if (Math.abs(sumPct - 100) > 0.1) {
        const diff = 100 - sumPct;
        items[items.length - 1].pct += diff;
      }

      sections.push({ field, items, total: fieldTotal });
    }

    // Sort sections by concentration (optional aesthetic)
    sections.sort((a, b) => (b.items[0]?.pct || 0) - (a.items[0]?.pct || 0));
    return sections;
  }, [scopeRows, demoLookups]);

  const scopeTitle = useMemo(() => {
    if (zoomCluster != null) return `Cluster C${zoomCluster}`;
    const sel = selectedModels;
    if (!sel?.length || sel.length === allModels.length)
      return "Selected Models (All)";
    if (sel.length === 1) return `Model: ${sel[0]}`;
    return `Models (${sel.length})`;
  }, [zoomCluster, selectedModels, allModels.length]);

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
        {group === "SUV" ? "SUV" : "Pickup"} Interactive Clusters
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
        {/* Dataset toggle */}
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

        {/* Color mode + Cluster zoom */}
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

      {/* Chart + Demographics */}
      <div
        style={{ display: "flex", gap: 16, alignItems: "stretch", height: 500 }}
      >
        {/* Chart */}
        <div
          style={{
            flex: 1,
            background: "#111827",
            border: "1px solid #1f2937",
            borderRadius: 12,
            padding: 10,
            height: "100%",
            boxSizing: "border-box",
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

        {/* Demographics Panel */}
        <div
          style={{
            width: 360,
            height: "100%",
            background: "#1e293b",
            border: "1px solid #334155",
            borderRadius: 12,
            padding: 12,
            color: "#cbd5e1",
            display: "flex",
            flexDirection: "column",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              marginBottom: 8,
            }}
          >
            <div style={{ fontWeight: 700, color: "#e5e7eb" }}>
              Demographics
            </div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>{scopeTitle}</div>
          </div>

          <div
            style={{
              overflowY: "auto",
              paddingRight: 4,
              gap: 12,
              display: "flex",
              flexDirection: "column",
            }}
          >
            {demoSummary.length === 0 ? (
              <div
                style={{
                  fontStyle: "italic",
                  opacity: 0.8,
                  padding: "8px 4px",
                }}
              >
                No demographic fields observed in current scope.
              </div>
            ) : (
              demoSummary.map((section) => (
                <div
                  key={section.field}
                  style={{
                    background: "#0b1220",
                    border: "1px solid #334155",
                    borderRadius: 8,
                    padding: 10,
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      marginBottom: 8,
                      color: "#e5e7eb",
                    }}
                  >
                    {section.field}
                  </div>

                  {section.items.map((it) => (
                    <div
                      key={`${section.field}::${it.label}`}
                      style={{ marginBottom: 6 }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          justifyContent: "space-between",
                          gap: 8,
                        }}
                      >
                        <div style={{ fontSize: 12, color: "#cbd5e1" }}>
                          {it.label}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            fontVariantNumeric: "tabular-nums",
                            color: "#e5e7eb",
                          }}
                        >
                          {it.pct.toFixed(1)}%{" "}
                          <span style={{ opacity: 0.6 }}>
                            ({it.count.toLocaleString()})
                          </span>
                        </div>
                      </div>
                      <div
                        style={{
                          height: 6,
                          background: "#0f172a",
                          border: "1px solid #334155",
                          borderRadius: 999,
                          overflow: "hidden",
                          marginTop: 4,
                        }}
                      >
                        <div
                          style={{
                            width: `${Math.min(100, it.pct).toFixed(2)}%`,
                            height: "100%",
                            background: "#FF5432",
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
