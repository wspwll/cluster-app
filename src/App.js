import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  CartesianGrid,
  XAxis,
  YAxis,
  Legend,
  // histogram bits:
  BarChart,
  Bar,
  Tooltip,
  LineChart,
  Line,
  AreaChart,
  Area,
} from "recharts";
import suvPoints from "./data/suv_points.json";
import puPoints from "./data/pu_points.json";
import demosMapping from "./data/demos-mapping.json";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";

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

const US_TOPO = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";

const US_STATE_ABBR_TO_NAME = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  DC: "District of Columbia",
};
const US_STATE_NAME_SET = new Set(Object.values(US_STATE_ABBR_TO_NAME));

function toStateName(labelRaw) {
  if (!labelRaw) return null;
  const s = String(labelRaw).trim();

  const up = s.toUpperCase();
  if (US_STATE_ABBR_TO_NAME[up]) return US_STATE_ABBR_TO_NAME[up];

  const lower = s.toLowerCase();
  for (const name of US_STATE_NAME_SET) {
    if (name.toLowerCase() === lower) return name;
  }

  const two = (s.match(/\b[A-Z]{2}\b/g) || []).find(
    (tok) => US_STATE_ABBR_TO_NAME[tok.toUpperCase()]
  );
  if (two) return US_STATE_ABBR_TO_NAME[two.toUpperCase()];

  return null;
}

// ---------- color helpers ----------
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function hexToRgb(h) {
  const s = h.replace("#", "");
  const v =
    s.length === 3
      ? s
          .split("")
          .map((c) => c + c)
          .join("")
      : s;
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  };
}
function rgbToHex({ r, g, b }) {
  const to = (x) => x.toString(16).padStart(2, "0");
  return `#${to(Math.round(r))}${to(Math.round(g))}${to(Math.round(b))}`;
}
function blendHex(aHex, bHex, t) {
  const a = hexToRgb(aHex),
    b = hexToRgb(bHex);
  return rgbToHex({
    r: lerp(a.r, b.r, t),
    g: lerp(a.g, b.g, t),
    b: lerp(a.b, b.b, t),
  });
}
function colorForKey(key, allKeys) {
  const keyStr = String(key);
  const idx = allKeys.findIndex((k) => String(k) === keyStr);
  return COLORS[(idx >= 0 ? idx : 0) % COLORS.length];
}

// ---------- chart helpers ----------
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

function BigDot({ cx, cy, fill }) {
  return <circle cx={cx} cy={cy} r={10} fill={fill} />;
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

// Keys we’ll scan for state-like values
const STATE_KEYS = [
  "ADMARK_STATE",
  "admark_state",
  "STATE",
  "State",
  "state",
  "DM_STATE",
  "DM_STATE_CODE",
  "STATE_ABBR",
  "state_abbr",
  "ST",
  "st",
];

/** ===== Field Groups for the right-side dropdown ===== */
const FIELD_GROUPS = {
  Demographics: [
    "BLD_AGE_GRP",
    "DEMO_EDUCATION",
    "GENERATION_GRP",
    "DEMO_GENDER1",
    "BLD_HOBBY1_GRP",
    "DEMO_INCOME",
    "BLD_LIFESTAGE",
    "DEMO_LOCATION",
    "DEMO_MARITAL",
    "DEMO_EMPLOY",
    "ADMARK_STATE",
    "BLD_CHILDREN",
    "DEMO_EMPTY_NESTER",
  ],
  Financing: [
    "FIN_PU_APR",
    "FIN_PU_DOWN_PAY",
    "FIN_PU_TRADE_IN",
    "BLD_FIN_TOTAL_MONPAY",
    "FIN_PRICE_UNEDITED",
    "FIN_LE_LENGTH",
    "FIN_PU_LENGTH",
    "C1_PL",
    "FIN_CREDIT",
  ],

  "Buying Behavior": ["PR_MOST", "C2S_MODEL_RESPONSE", "SRC_TOP1"],
  Loyalty: [
    "OL_MODEL_GRP",
    "STATE_BUY_BEST",
    "STATE_CONTINUE",
    "STATE_FEEL_GOOD",
    "STATE_REFER",
    "STATE_PRESTIGE",
    "STATE_EURO",
    "STATE_AMER",
    "STATE_ASIAN",
    "STATE_SWITCH_FEAT",
    "STATE_VALUES",
  ],
  "Willingness to Pay": [
    "PV_TAX_INS",
    "PV_SPEND_LUXURY",
    "PV_PRESTIGE",
    "PV_QUALITY",
    "PV_RESALE",
    "PV_INEXP_MAINTAIN",
    "PV_AVOID",
    "PV_SURVIVE",
    "PV_PAY_MORE",
    "PV_BREAKDOWN",
    "PV_VALUE",
    "PV_SPEND",
    "PV_LEASE",
    "PV_PUTOFF",
    "STATE_BALANCE",
    "STATE_WAIT",
    "STATE_ENJOY_PRESTIGE",
    "STATE_FIRST_YR",
    "STATE_NO_LOW_PRICE",
    "STATE_AUDIO",
    "STATE_MON_PAY",
    "STATE_SHOP_MANY",
  ],
};

/** ---------- Financing helpers (formatting + numeric detection) ---------- */
function coerceNumber(v) {
  if (v === null || v === undefined) return NaN;
  const n = Number(String(v).trim().replace(/,/g, ""));
  return Number.isFinite(n) ? n : NaN;
}
function isLikelyPercentField(field) {
  return /APR|PCT|PERCENT/i.test(field);
}
function isLikelyCurrencyField(field) {
  return /DOWN|TRADE|PAY|MONPAY|PAYMENT|PRICE/i.test(field);
}
function isLikelyLengthField(field) {
  return /LENGTH/i.test(field);
}
function formatFinValue(field, n) {
  if (Number.isNaN(n)) return "—";
  if (isLikelyPercentField(field)) return `${n.toFixed(1)}%`;
  if (isLikelyCurrencyField(field)) {
    return n.toLocaleString(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });
  }
  if (isLikelyLengthField(field)) return `${n.toFixed(0)} mo`;
  return n.toLocaleString();
}

// ---- fixed-bucket histogram for FIN_PRICE_UNEDITED ----
function coercePrice(v) {
  if (v === null || v === undefined) return NaN;
  const n = Number(String(v).replace(/[$,]/g, "").trim());
  return Number.isFinite(n) ? n : NaN;
}

const BUCKET_MIN = 30000; // start of first 5k bucket
const BUCKET_STEP = 5000; // 5k wide
const OVER_MIN = 110000; // 110k+ catch-all

function fmtK(n) {
  return `$${Math.round(n / 1000)}k`;
}
function fmtKDec(n) {
  return `$${(n / 1000).toFixed(1)}k`;
}

function bucketLabel(low, high) {
  if (low === -Infinity) return "Under $30k";
  if (high === Infinity) return "$110k+";
  const displayHigh = high - 100;
  return `${fmtK(low)} to ${fmtKDec(displayHigh)}`;
}

/**
 * Build fixed 5k buckets (Under $30k, $30k to $34.9k, ... $110k+)
 * Returns { data:[{label,count,pct,...}], totalValid }
 */
function buildFixedPriceBuckets_FIN(scopeRows) {
  const vals = [];
  for (const r of scopeRows) {
    const n = coercePrice(r?.FIN_PRICE_UNEDITED);
    if (Number.isFinite(n)) vals.push(n);
  }
  const totalValid = vals.length;

  const ranges = [];
  ranges.push({ low: -Infinity, high: BUCKET_MIN });
  for (let low = BUCKET_MIN; low < OVER_MIN; low += BUCKET_STEP) {
    const high = low + BUCKET_STEP;
    ranges.push({ low, high });
  }
  ranges.push({ low: OVER_MIN, high: Infinity });

  const buckets = ranges.map((r) => ({
    label: bucketLabel(r.low, r.high),
    low: r.low,
    high: r.high,
    count: 0,
    pct: 0,
  }));

  for (const v of vals) {
    let idx = -1;
    if (v < BUCKET_MIN) idx = 0;
    else if (v >= OVER_MIN) idx = buckets.length - 1;
    else {
      const stepIdx = Math.floor((v - BUCKET_MIN) / BUCKET_STEP);
      idx =
        1 +
        Math.max(
          0,
          Math.min(stepIdx, (OVER_MIN - BUCKET_MIN) / BUCKET_STEP - 1)
        );
    }
    if (idx >= 0) buckets[idx].count += 1;
  }

  if (totalValid > 0) {
    for (const b of buckets) {
      b.pct = (b.count / totalValid) * 100;
    }
  }

  return { data: buckets, totalValid };
}

function getFixedBucketRanges() {
  const ranges = [];
  // Under $30k
  ranges.push({
    low: -Infinity,
    high: BUCKET_MIN,
    label: bucketLabel(-Infinity, BUCKET_MIN),
  });
  // $30k .. $109.9k in 5k steps
  for (let low = BUCKET_MIN; low < OVER_MIN; low += BUCKET_STEP) {
    const high = low + BUCKET_STEP;
    ranges.push({ low, high, label: bucketLabel(low, high) });
  }
  // $110k+
  ranges.push({
    low: OVER_MIN,
    high: Infinity,
    label: bucketLabel(OVER_MIN, Infinity),
  });
  return ranges;
}

function buildBucketsForRows(rows) {
  const ranges = getFixedBucketRanges();
  const buckets = ranges.map((r) => ({ ...r, count: 0, pct: 0 }));

  const vals = [];
  for (const r of rows) {
    const n = coercePrice(r?.FIN_PRICE_UNEDITED);
    if (Number.isFinite(n)) vals.push(n);
  }
  const totalValid = vals.length;
  if (totalValid === 0) return { data: [], totalValid: 0 };

  for (const v of vals) {
    let idx = -1;
    if (v < BUCKET_MIN) {
      idx = 0;
    } else if (v >= OVER_MIN) {
      idx = buckets.length - 1;
    } else {
      const stepIdx = Math.floor((v - BUCKET_MIN) / BUCKET_STEP);
      idx =
        1 +
        Math.max(
          0,
          Math.min(stepIdx, (OVER_MIN - BUCKET_MIN) / BUCKET_STEP - 1)
        );
    }
    if (idx >= 0) buckets[idx].count += 1;
  }

  for (const b of buckets) {
    b.pct = totalValid > 0 ? (b.count / totalValid) * 100 : 0;
  }

  // Recharts-friendly rows
  const data = buckets.map((b) => ({
    label: b.label,
    pct: b.pct,
    count: b.count,
  }));
  return { data, totalValid };
}

/** Build series for AreaChart grouped by a key ('cluster' or 'model') */
function buildPriceSeriesByGroup(rows, groupingKey, groupOrder) {
  const byGroup = new Map();
  for (const r of rows) {
    const k = groupingKey === "cluster" ? r.cluster : String(r.model);
    if (!byGroup.has(k)) byGroup.set(k, []);
    byGroup.get(k).push(r);
  }
  const keys = groupOrder ?? Array.from(byGroup.keys());
  const series = [];
  for (const k of keys) {
    const arr = byGroup.get(k) || [];
    const { data } = buildBucketsForRows(arr);
    if (data.length) series.push({ key: k, data });
  }
  return series;
}

// ---- histogram helpers (Transaction Price card) ----
const PRICE_FIELDS = ["FIN_PRICE_UNEDITED", "PRICE_PAID", "TRANSACTION_PRICE"];
function pickPrice(r) {
  for (const f of PRICE_FIELDS) {
    if (f in r) {
      const n = coerceNumber(r[f]);
      if (Number.isFinite(n)) return n;
    }
  }
  return NaN;
}
function buildHistogram(rows, binCount = 12) {
  const vals = rows.map(pickPrice).filter((n) => Number.isFinite(n));
  if (vals.length < 2) return { bins: [], min: 0, max: 0, total: 0 };

  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = Math.max(1, max - min);
  const width = span / binCount;

  const bins = Array.from({ length: binCount }, (_, i) => ({
    x0: min + i * width,
    x1: min + (i + 1) * width,
    count: 0,
  }));

  for (const v of vals) {
    let idx = Math.floor((v - min) / width);
    if (idx >= binCount) idx = binCount - 1;
    bins[idx].count += 1;
  }
  const total = vals.length;

  const data = bins.map((b) => ({
    range: `${b.x0}`,
    mid: (b.x0 + b.x1) / 2,
    count: b.count,
  }));

  return { bins: data, min, max, total };
}

// ---- Attitudes: detect "agree" on Likert / label values ----
const AGREE_LABELS = new Set([
  "strongly agree",
  "agree",
  "somewhat agree",
  "somewhatagree", // just in case
  "sa",
  "a",
  "swa",
]);

function normalizeStr(v) {
  return String(v ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Returns:
 *   1  → agree (SA/A/SWA)
 *   0  → not agree (neutral/disagree)
 *  NaN → missing/unknown
 */
function agreeIndicator(raw) {
  if (raw === null || raw === undefined) return NaN;

  // If it's numeric Likert, try common scales:
  const num = Number(raw);
  if (Number.isFinite(num)) {
    // 1–7 scale → 5/6/7 = agree
    if (num >= 1 && num <= 7) return num >= 5 ? 1 : 0;
    // 1–5 scale → 4/5 = agree
    if (num >= 1 && num <= 5) return num >= 4 ? 1 : 0;
    // percentages already? treat >=50 as "agree" presence is unknown per-respondent, so NaN
    return NaN;
  }

  // String labels
  const s = normalizeStr(raw);
  if (!s) return NaN;

  // exact/contains checks
  if (AGREE_LABELS.has(s)) return 1;
  if (
    s.includes("strongly agree") ||
    s === "stronglyagree" ||
    s.includes("somewhat agree") ||
    s === "somewhatagree" ||
    s === "agree"
  ) {
    return 1;
  }

  // some datasets store like "7 - Strongly agree"
  const m = s.match(/^(\d)\s*[-–]\s*(.*)$/);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) {
      if (n >= 1 && n <= 7) return n >= 5 ? 1 : 0;
      if (n >= 1 && n <= 5) return n >= 4 ? 1 : 0;
    }
  }

  // neutral/other
  return 0;
}

/** % Agree for a variable within a row set */
function percentAgree(rows, varName) {
  let agree = 0,
    valid = 0;
  for (const r of rows) {
    const ind = agreeIndicator(r?.[varName]);
    if (Number.isNaN(ind)) continue;
    valid += 1;
    agree += ind;
  }
  return valid > 0 ? (agree / valid) * 100 : NaN;
}

// --- Label resolution from demos-mapping.json (and common aliases) ---
function getAttRaw(row, varName) {
  // try the field as-is first
  const v = row?.[varName];
  if (v !== undefined && v !== null && String(v).trim() !== "") return v;

  // common alias suffixes some exports create
  const aliases = [
    `${varName}_LABEL`,
    `${varName}_TXT`,
    `${varName}_TEXT`,
    `${varName}_DESC`,
    `${varName}_LAB`,
  ];
  for (const a of aliases) {
    const va = row?.[a];
    if (va !== undefined && va !== null && String(va).trim() !== "") return va;
  }
  return null;
}

function normalizeLabel(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Resolve a *display label* for the value in row[varName] using demos-mapping.
 * - If value is a code present in the mapping (by number/string), return mapped label.
 * - Otherwise, return the original value as a string label.
 */
function resolveMappedLabel(row, varName, demoLookups) {
  const raw = getAttRaw(row, varName);
  if (raw === null || raw === undefined) return null;

  const codeMap = demoLookups.get(varName) || new Map();

  // Direct map lookups (as-is, string, number)
  if (codeMap.has(raw)) return codeMap.get(raw);
  const asStr = String(raw);
  if (codeMap.has(asStr)) return codeMap.get(asStr);
  const asNum = Number(asStr);
  if (Number.isFinite(asNum)) {
    if (codeMap.has(asNum)) return codeMap.get(asNum);
    if (codeMap.has(String(asNum))) return codeMap.get(String(asNum));
  }

  // No mapping? fall back to the raw value as a label
  return asStr;
}

/** True if the label counts as "agree" for standard loyalty items */
function isAgreeLabel(label) {
  const s = normalizeLabel(label);

  // Allow exact/typical forms
  if (
    s === "strongly agree" ||
    s === "agree" ||
    s === "somewhat agree" ||
    s === "somewhatagree" ||
    s === "sa" ||
    s === "a" ||
    s === "swa"
  ) {
    return true;
  }

  // Generic fallback: contains "agree" but NOT "disagree"
  if (s.includes("agree") && !s.includes("disagree")) return true;

  return false;
}

function percentAgreeMapped(
  rows,
  varName,
  demoLookups,
  { includeMissingInDenom = false } = {}
) {
  let agree = 0,
    valid = 0,
    missing = 0;

  const specialLoyal = varName === "OL_MODEL_GRP";
  for (const r of rows) {
    const lab = resolveMappedLabel(r, varName, demoLookups);
    if (!lab) {
      missing += 1;
      continue;
    }

    valid += 1;
    if (specialLoyal) {
      if (normalizeLabel(lab) === "loyal") agree += 1;
    } else {
      if (isAgreeLabel(lab)) agree += 1;
    }
  }

  const denom = includeMissingInDenom ? valid + missing : valid;
  return denom > 0 ? (agree / denom) * 100 : NaN;
}

/* ================== NEW: Policy-based agree % to match the card ================== */
// Sets used for top-2 vs top-3
const AGREE_TOP3 = new Set(["strongly agree", "agree", "somewhat agree"]);
const AGREE_TOP2 = new Set(["strongly agree", "somewhat agree"]);

// Decide which policy to use for a variable
function agreePolicyFor(varName) {
  if (varName === "OL_MODEL_GRP") return "LOYAL_ONLY";
  if (/^STATE_/i.test(varName)) return "TOP2"; // STATE_* → top-2 box
  return "TOP3"; // default
}

function isTopNAgree(label, policy) {
  const s = normalizeLabel(label);
  if (policy === "LOYAL_ONLY") return s === "loyal";
  if (policy === "TOP2") return AGREE_TOP2.has(s);
  return AGREE_TOP3.has(s); // default TOP3
}

/**
 * Percent "agree" via mapped labels following per-variable policy.
 * Set includeMissingInDenom=true to match the card's denominator (Unknown included).
 */
function percentAgreeMappedPolicy(
  rows,
  varName,
  demoLookups,
  { includeMissingInDenom = true } = {}
) {
  let agree = 0,
    valid = 0,
    missing = 0;
  const policy = agreePolicyFor(varName);

  for (const r of rows) {
    const lab = resolveMappedLabel(r, varName, demoLookups);
    if (!lab) {
      missing++;
      continue;
    }
    valid++;
    if (isTopNAgree(lab, policy)) agree++;
  }
  const denom = includeMissingInDenom ? valid + missing : valid;
  return denom > 0 ? (agree / denom) * 100 : NaN;
}
/* ================================================================================ */

export default function App() {
  const [group, setGroup] = useState("SUV");
  const dataPoints = group === "SUV" ? suvPoints : puPoints;

  // Normalize rows
  const rows = useMemo(() => {
    const out = [];
    for (const r of dataPoints || []) {
      const modelVal =
        r?.model ??
        r?.BLD_DESC_RV_MODEL ??
        r?.Model ??
        r?.model_name ??
        r?.MODEL ??
        null;
      const x = Number(r?.emb_x);
      const y = Number(r?.emb_y);
      const cl = Number(r?.cluster);
      if (
        !modelVal ||
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        !Number.isFinite(cl)
      )
        continue;

      out.push({
        ...r,
        model: String(modelVal),
        // keep a permanent copy of the raw UMAP coords
        raw_x: x,
        raw_y: y,
        // these are the *displayed* coords (may be lerped later)
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
  const [colorMode, setColorMode] = useState("cluster");
  const [zoomCluster, setZoomCluster] = useState(null);
  const [centerT, setCenterT] = useState(0);
  const [selectedStateName, setSelectedStateName] = useState(null);

  // Right-side category
  const [selectedFieldGroup, setSelectedFieldGroup] = useState("Demographics");

  useEffect(() => setSelectedModels(allModels), [allModels]);
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

  // --- LOOKUP TABLES (incl. ADMARK_STATE code → label) ---
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

  // Resolve full state name from row
  const getRowStateName = useMemo(() => {
    const codeMap = demoLookups.get("ADMARK_STATE") || new Map();
    return (row) => {
      for (const k of STATE_KEYS) {
        if (row && row[k] != null && String(row[k]).trim() !== "") {
          let raw = row[k];
          let val = String(raw).trim();

          if (k === "ADMARK_STATE") {
            const mapped =
              codeMap.get(raw) ||
              codeMap.get(String(raw)) ||
              codeMap.get(Number(raw));
            if (mapped) val = String(mapped).trim();
          }

          const name =
            toStateName(val) ||
            US_STATE_ABBR_TO_NAME[String(val).toUpperCase()] ||
            null;
          if (name) return name;

          const two = (val.match(/\b[A-Z]{2}\b/g) || []).find(
            (tok) => US_STATE_ABBR_TO_NAME[tok.toUpperCase()]
          );
          if (two) return US_STATE_ABBR_TO_NAME[two.toUpperCase()];
        }
      }
      return null;
    };
  }, [demoLookups]);

  // Model filter ONLY (scatter not affected by state)
  const baseByModel = useMemo(() => {
    const active = selectedModels?.length ? selectedModels : allModels;
    return rows.filter((r) => active.includes(r.model));
  }, [rows, selectedModels, allModels]);

  // Scatter frame (model + optional cluster zoom)
  const plotFrame = useMemo(
    () =>
      zoomCluster == null
        ? baseByModel
        : baseByModel.filter((r) => r.cluster === zoomCluster),
    [baseByModel, zoomCluster]
  );

  // Demographics scope (model + optional cluster zoom + optional state)
  const scopeRows = useMemo(() => {
    const base =
      zoomCluster == null
        ? baseByModel
        : baseByModel.filter((r) => r.cluster === zoomCluster);
    if (!selectedStateName) return base;
    return base.filter((r) => getRowStateName(r) === selectedStateName);
  }, [baseByModel, zoomCluster, selectedStateName, getRowStateName]);

  const availableClusters = useMemo(
    () =>
      Array.from(new Set(baseByModel.map((r) => r.cluster))).sort(
        (a, b) => a - b
      ),
    [baseByModel]
  );

  useEffect(() => {
    if (zoomCluster != null && !availableClusters.includes(zoomCluster))
      setZoomCluster(null);
  }, [availableClusters, zoomCluster]);

  // Centroids for collapsing
  const groupingKey = colorMode === "cluster" ? "cluster" : "model";
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
    if (centerT <= 0) return plotFrame; // uses emb_x/emb_y == raw_x/raw_y
    const out = new Array(plotFrame.length);
    for (let i = 0; i < plotFrame.length; i++) {
      const r = plotFrame[i];
      const key = colorMode === "cluster" ? r.cluster : String(r.model);
      const c = centroidsByGroup.get(key);
      out[i] = c
        ? {
            ...r,
            // keep raw_x/raw_y intact; only change displayed emb_x/emb_y
            emb_x: lerp(r.raw_x, c.cx, centerT),
            emb_y: lerp(r.raw_y, c.cy, centerT),
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

  const modelsInScope = useMemo(() => {
    const set = new Set();
    for (const r of plotFrame) set.add(r.model);
    return Array.from(set).sort();
  }, [plotFrame]);

  const [demoModel, setDemoModel] = useState(null);
  useEffect(() => {
    if (demoModel && !modelsInScope.includes(demoModel)) setDemoModel(null);
  }, [modelsInScope, demoModel]);

  // Attitudes selections (default to first in each group)
  const LOYALTY_VARS = FIELD_GROUPS.Loyalty;
  const WTP_VARS = FIELD_GROUPS["Willingness to Pay"];
  const [attXVar, setAttXVar] = useState(LOYALTY_VARS[0]);
  const [attYVar, setAttYVar] = useState(WTP_VARS[0]);

  // Attitudes points computed from current scopeRows (includes state filter)
  const attitudesPoints = useMemo(() => {
    const gkey = colorMode === "cluster" ? "cluster" : "model";
    const srcRows = demoModel
      ? scopeRows.filter((r) => r.model === demoModel)
      : scopeRows;
    const byGroup = new Map();
    for (const r of srcRows) {
      const k = colorMode === "cluster" ? r.cluster : String(r.model);
      if (!byGroup.has(k)) byGroup.set(k, []);
      byGroup.get(k).push(r);
    }

    const order = groupKeys; // keep consistent colors with scatter/price chart
    const pts = [];
    for (const k of order) {
      const rows = byGroup.get(k) || [];
      // === use policy-based agree that matches the right-hand card ===
      const x = percentAgreeMappedPolicy(rows, attXVar, demoLookups, {
        includeMissingInDenom: true,
      });
      const y = percentAgreeMappedPolicy(rows, attYVar, demoLookups, {
        includeMissingInDenom: true,
      });
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      pts.push({
        key: k,
        name: colorMode === "cluster" ? `C${k}` : String(k),
        x,
        y,
        n: rows.length,
        color: colorForKey(k, order),
      });
    }
    return pts;
  }, [
    scopeRows,
    colorMode,
    groupKeys,
    attXVar,
    attYVar,
    demoLookups,
    demoModel,
  ]);

  const clusterCentroidsForHotspots = useMemo(() => {
    const byCluster = new Map();
    for (const r of baseByModel) {
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
  }, [baseByModel]);

  // Axis tweening (based on plot frame)
  const targetX = useMemo(
    () => paddedDomain(plotFrame.map((r) => r.emb_x)),
    [plotFrame]
  );
  const targetY = useMemo(
    () => paddedDomain(plotFrame.map((r) => r.emb_y)),
    [plotFrame]
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

  // ---------------- Demographics (map context) ----------------
  const demoBaseRows = useMemo(() => {
    return zoomCluster == null
      ? baseByModel
      : baseByModel.filter((r) => r.cluster === zoomCluster);
  }, [baseByModel, zoomCluster]);

  const mapBaseRows = useMemo(() => {
    return demoModel
      ? demoBaseRows.filter((r) => r.model === demoModel)
      : demoBaseRows;
  }, [demoBaseRows, demoModel]);

  const stateAgg = useMemo(() => {
    const counts = new Map();
    let total = 0;

    for (const r of mapBaseRows) {
      const name = getRowStateName(r);
      if (!name) continue;
      counts.set(name, (counts.get(name) || 0) + 1);
      total += 1;
    }

    const pcts = new Map();
    let maxPct = 0;

    if (total > 0) {
      for (const [name, c] of counts.entries()) {
        const pct = (c / total) * 100;
        pcts.set(name, pct);
        if (pct > maxPct) maxPct = pct;
      }
    }

    return { counts, pcts, total, maxPct };
  }, [mapBaseRows, getRowStateName]);

  const [hoverState, setHoverState] = useState(null);

  /** ===== Summary builder restricted to selected field group ===== */
  const demoSummary = useMemo(() => {
    const sections = [];

    const fields = FIELD_GROUPS[selectedFieldGroup] || [];
    const srcAll = demoModel
      ? scopeRows.filter((r) => r.model === demoModel)
      : scopeRows;

    // Financing fields that should ALWAYS be categorical
    const categoricalFinFields = new Set(["C1_PL", "FIN_CREDIT"]);

    for (const field of fields) {
      const codeMap = demoLookups.get(field) || new Map();

      // Numeric aggregation for Financing fields not forced categorical
      const isFinancingNumeric =
        selectedFieldGroup === "Financing" && !categoricalFinFields.has(field);

      if (isFinancingNumeric) {
        let sum = 0;
        let wsum = 0;
        let nValid = 0;
        let nMissing = 0;

        for (const r of srcAll) {
          const rawVal = r?.[field];
          const num = coerceNumber(rawVal);
          if (Number.isFinite(num)) {
            sum += num;
            wsum += 1;
            nValid++;
          } else {
            nMissing++;
          }
        }

        if (nValid > 0) {
          const avg = wsum > 0 ? sum / wsum : NaN;
          sections.push({
            field,
            mode: "numeric",
            kpi: {
              label: "Average",
              value: avg,
              display: formatFinValue(field, avg),
              nValid,
              nMissing,
            },
          });
          continue;
        }
        // fall through to categorical if no numeric data
      }

      // ---------- Categorical (% of total) ----------
      const counts = new Map();
      let validCount = 0;
      let missingCount = 0;

      for (const r of srcAll) {
        const rawVal = r?.[field];
        if (
          rawVal === undefined ||
          rawVal === null ||
          String(rawVal).trim() === ""
        ) {
          missingCount++;
          continue;
        }

        let label = String(rawVal).trim();
        if (codeMap.has(rawVal)) label = codeMap.get(rawVal);
        else if (codeMap.has(String(rawVal)))
          label = codeMap.get(String(rawVal));
        else if (codeMap.has(Number(rawVal)))
          label = codeMap.get(Number(rawVal));
        else {
          const asNum = Number(label);
          if (Number.isFinite(asNum) && codeMap.has(asNum))
            label = codeMap.get(asNum);
          else if (codeMap.has(String(asNum)))
            label = codeMap.get(String(asNum));
        }

        counts.set(label, (counts.get(label) || 0) + 1);
        validCount++;
      }

      if (validCount + missingCount === 0) continue;

      const fieldTotal = validCount + missingCount;
      const items = Array.from(counts.entries())
        .map(([label, count]) => ({
          label,
          count,
          pct: (count / fieldTotal) * 100,
        }))
        .sort((a, b) => b.count - a.count);

      if (missingCount > 0) {
        items.push({
          label: "Unknown",
          count: missingCount,
          pct: (missingCount / fieldTotal) * 100,
        });
      }

      const sumPct = items.reduce((a, b) => a + b.pct, 0);
      if (Math.abs(sumPct - 100) > 0.1 && items.length > 0) {
        const diff = 100 - sumPct;
        items[items.length - 1].pct += diff;
      }

      sections.push({ field, mode: "categorical", items, total: fieldTotal });
    }

    sections.sort((a, b) => {
      if (a.mode !== b.mode) return a.mode === "numeric" ? -1 : 1;
      return (b.items?.[0]?.pct || 0) - (a.items?.[0]?.pct || 0);
    });

    return sections;
  }, [scopeRows, demoModel, demoLookups, selectedFieldGroup]);

  // ---------- UI ----------
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
      <h1 style={{ margin: 0, marginBottom: 8, color: "#FF5432" }}>
        Customer Groups
      </h1>

      {/* tiny status line */}
      <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 12 }}>
        Records (models filter): {baseByModel.length.toLocaleString()}
        {zoomCluster != null ? ` • Zoom C${zoomCluster}` : ""}
        {selectedStateName
          ? ` • Demographics filtered to ${selectedStateName}`
          : ""}
      </div>

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
                >{`C${k}`}</button>
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
          </div>
        </div>
      </div>

      {/* Chart + Right Panel */}
      <div
        style={{ display: "flex", gap: 16, alignItems: "stretch", height: 500 }}
      >
        {/* Chart (NOT filtered by state) */}
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
                domain={animX}
                tickFormatter={() => ""}
                tickLine={false}
                axisLine={false}
                tickMargin={0}
              />
              <YAxis
                type="number"
                dataKey="emb_y"
                domain={animY}
                tickFormatter={() => ""}
                tickLine={false}
                axisLine={false}
                tickMargin={0}
              />

              <Tooltip
                cursor={{ stroke: "#334155" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  // Recharts gives one entry per series; read the first payload:
                  const p = payload[0]?.payload ?? {};
                  const umapX = Number(p.raw_x); // original UMAP 1 (from JSON)
                  const umapY = Number(p.raw_y); // original UMAP 2 (from JSON)
                  const dispX = Number(p.emb_x); // what’s currently plotted (may be centered)
                  const dispY = Number(p.emb_y);
                  const seriesName = payload[0]?.name ?? "";

                  return (
                    <div
                      style={{
                        background: "#0b1220",
                        border: "1px solid #334155",
                        color: "#e5e7eb",
                        borderRadius: 8,
                        padding: "8px 10px",
                        fontSize: 12,
                        maxWidth: 240,
                      }}
                    >
                      {seriesName && (
                        <div style={{ fontWeight: 700, marginBottom: 4 }}>
                          {seriesName}
                        </div>
                      )}

                      {/* Raw UMAP coordinates — use these for range rules */}
                      <div style={{ opacity: 0.85, marginBottom: 4 }}>
                        UMAP (raw)
                      </div>
                      <div>
                        UMAP&nbsp;1 (x):{" "}
                        {Number.isFinite(umapX) ? umapX.toFixed(4) : "—"}
                      </div>
                      <div>
                        UMAP&nbsp;2 (y):{" "}
                        {Number.isFinite(umapY) ? umapY.toFixed(4) : "—"}
                      </div>

                      {/* Current display (changes when Center focus > 0) */}
                      <div
                        style={{ opacity: 0.85, marginTop: 8, marginBottom: 4 }}
                      >
                        Displayed{centerT > 0 ? " (centered)" : ""}
                      </div>
                      <div>
                        x: {Number.isFinite(dispX) ? dispX.toFixed(4) : "—"}
                      </div>
                      <div>
                        y: {Number.isFinite(dispY) ? dispY.toFixed(4) : "—"}
                      </div>
                    </div>
                  );
                }}
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

        {/* Right Panel: Category dropdown + sections (FILTERED by selectedStateName) */}
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
          {/* Header row with category dropdown */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 8,
              gap: 8,
            }}
          >
            <select
              value={selectedFieldGroup}
              onChange={(e) => setSelectedFieldGroup(e.target.value)}
              style={{
                background: "#0b1220",
                color: "#e5e7eb",
                border: "1px solid #334155",
                padding: "6px 10px",
                borderRadius: 8,
                fontWeight: 700,
              }}
              title="Choose category"
            >
              {Object.keys(FIELD_GROUPS).map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>

          {/* Model focus (single-select) */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
              marginBottom: 10,
            }}
          >
            <button
              onClick={() => setDemoModel(null)}
              style={{
                background: demoModel == null ? "#FF5432" : "#0b1220",
                color: demoModel == null ? "white" : "#cbd5e1",
                border:
                  demoModel == null ? "1px solid #FF5432" : "1px solid #334155",
                borderRadius: 8,
                padding: "4px 8px",
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              All
            </button>
            {modelsInScope.map((m) => {
              const active = demoModel === m;
              return (
                <button
                  key={`demoModel-${m}`}
                  onClick={() => setDemoModel(m)}
                  style={{
                    background: active ? "#FF5432" : "#0b1220",
                    color: active ? "white" : "#cbd5e1",
                    border: active ? "1px solid #FF5432" : "1px solid #334155",
                    borderRadius: 8,
                    padding: "4px 8px",
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                  title={m}
                >
                  {m}
                </button>
              );
            })}
          </div>

          {/* Sections list */}
          <div
            style={{
              overflowY: "auto",
              paddingRight: 4,
              gap: 12,
              display: "flex",
              flexDirection: "column",
            }}
          >
            {selectedStateName && scopeRows.length === 0 ? (
              <div
                style={{
                  fontStyle: "italic",
                  opacity: 0.85,
                  padding: "8px 4px",
                }}
              >
                No records for <b>{selectedStateName}</b> in current scope
                (check ADMARK_STATE coding).
              </div>
            ) : demoSummary.length === 0 ? (
              <div
                style={{
                  fontStyle: "italic",
                  opacity: 0.8,
                  padding: "8px 4px",
                }}
              >
                No fields observed in current scope.
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

                  {/* Numeric KPI (Financing averages) */}
                  {section.mode === "numeric" ? (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        background: "#111827",
                        border: "1px solid #1f2937",
                        borderRadius: 8,
                        padding: "10px 12px",
                      }}
                    >
                      <div style={{ fontSize: 12, opacity: 0.8 }}>Average</div>
                      <div
                        style={{
                          fontSize: 18,
                          fontWeight: 800,
                          color: "#FF5432",
                        }}
                      >
                        {section.kpi.display}
                      </div>
                      <div style={{ fontSize: 11, opacity: 0.7 }}>
                        n={section.kpi.nValid.toLocaleString()}
                        {section.kpi.nMissing
                          ? ` • missing=${section.kpi.nMissing.toLocaleString()}`
                          : ""}
                      </div>
                    </div>
                  ) : (
                    // Categorical (% of total)
                    section.items.map((it) => (
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
                    ))
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Bottom row: Stacked (Attitudes over TP) + Map */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "3fr 2fr", // 60% (left) / 40% (right)
          gap: 16,
          marginTop: 16,
          alignItems: "stretch",
        }}
      >
        {/* LEFT: Attitudes (top) + Transaction Price (bottom) */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
            minHeight: 640,
          }}
        >
          {/* Attitudes Scatterplot (TOP) */}
          <div
            style={{
              background: "#111827",
              border: "1px solid #1f2937",
              borderRadius: 12,
              padding: 12,
              flex: 1,
              minHeight: 300,
              boxSizing: "border-box",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div style={{ fontWeight: 700 }}>Attitudes Scatterplot</div>
              <div
                style={{
                  marginLeft: "auto",
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <label
                  style={{ display: "flex", alignItems: "center", gap: 6 }}
                >
                  <span style={{ fontSize: 12, opacity: 0.85 }}>
                    X (Loyalty):
                  </span>
                  <select
                    value={attXVar}
                    onChange={(e) => setAttXVar(e.target.value)}
                    style={{
                      background: "#0b1220",
                      color: "#e5e7eb",
                      border: "1px solid #334155",
                      padding: "6px 10px",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  >
                    {LOYALTY_VARS.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>

                <label
                  style={{ display: "flex", alignItems: "center", gap: 6 }}
                >
                  <span style={{ fontSize: 12, opacity: 0.85 }}>Y (WTP):</span>
                  <select
                    value={attYVar}
                    onChange={(e) => setAttYVar(e.target.value)}
                    style={{
                      background: "#0b1220",
                      color: "#e5e7eb",
                      border: "1px solid #334155",
                      padding: "6px 10px",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  >
                    {WTP_VARS.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <div style={{ flex: 1, minHeight: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart
                  margin={{ top: 8, right: 12, bottom: 24, left: 12 }}
                >
                  <CartesianGrid stroke="#1f2937" />
                  <XAxis
                    type="number"
                    dataKey="x"
                    name={attXVar}
                    tickFormatter={(v) => `${v.toFixed(0)}%`}
                    tick={{ fill: "#cbd5e1", fontSize: 12 }}
                    stroke="#334155"
                    domain={[0, 100]}
                  />
                  <YAxis
                    type="number"
                    dataKey="y"
                    name={attYVar}
                    tickFormatter={(v) => `${v.toFixed(0)}%`}
                    tick={{ fill: "#cbd5e1", fontSize: 12 }}
                    stroke="#334155"
                    domain={[0, 100]}
                  />
                  {/* No legend; color is consistent with main scatter */}
                  <Tooltip
                    cursor={{ stroke: "#334155" }}
                    contentStyle={{
                      background: "#0b1220",
                      border: "1px solid #334155",
                      color: "#e5e7eb",
                      borderRadius: 8,
                    }}
                    formatter={(value, name, payload) => {
                      if (name === "x")
                        return [`${Number(value).toFixed(1)}%`, attXVar];
                      if (name === "y")
                        return [`${Number(value).toFixed(1)}%`, attYVar];
                      return [value, name];
                    }}
                    labelFormatter={() => ""}
                  />
                  {attitudesPoints.map((pt) => (
                    <Scatter
                      key={`att-${pt.key}`}
                      name={pt.name}
                      data={[pt]}
                      fill={pt.color}
                      isAnimationActive={false}
                      shape="circle"
                      shape={<BigDot />}
                    />
                  ))}
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Transaction Price (BOTTOM) */}
          <div
            style={{
              background: "#111827",
              border: "1px solid #1f2937",
              borderRadius: 12,
              padding: 12,
              flex: 1,
              minHeight: 300,
              boxSizing: "border-box",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 8 }}>
              Transaction Price
            </div>

            {/* Fixed $5k buckets (% of respondents) using FIN_PRICE_UNEDITED and current scope */}
            <div style={{ flex: 1, minHeight: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                {(() => {
                  // Respect model focus in the right-hand card
                  const priceRows = demoModel
                    ? scopeRows.filter((r) => r.model === demoModel)
                    : scopeRows;

                  // Use the same grouping key as the scatter
                  const groupingKey =
                    colorMode === "cluster" ? "cluster" : "model";

                  // IMPORTANT: use the scatter's groupKeys for identical color mapping
                  const orderKeys = groupKeys;

                  const series = buildPriceSeriesByGroup(
                    priceRows,
                    groupingKey,
                    orderKeys
                  );

                  if (!series.length) {
                    return (
                      <div style={{ fontSize: 12, opacity: 0.75 }}>
                        No FIN_PRICE_UNEDITED data available in current scope.
                      </div>
                    );
                  }

                  // Dynamic Y max across all series
                  const maxPct = series.reduce(
                    (m, s) =>
                      Math.max(
                        m,
                        ...s.data.map((d) =>
                          Number.isFinite(d.pct) ? d.pct : 0
                        )
                      ),
                    0
                  );
                  const yMax = Math.ceil((maxPct + 2) / 5) * 5; // round up to nearest 5
                  const pctFmt = (v) => `${v.toFixed(0)}%`;

                  // Unified x labels (fixed-price buckets)
                  const xLabels = series[0].data.map((d) => d.label);

                  return (
                    <AreaChart
                      margin={{ top: 8, right: 8, left: 8, bottom: 56 }}
                    >
                      <CartesianGrid stroke="#1f2937" />
                      <XAxis
                        dataKey="label"
                        type="category"
                        allowDuplicatedCategory={false}
                        tick={{ fill: "#cbd5e1", fontSize: 11 }}
                        stroke="#334155"
                        interval={0}
                        angle={-20}
                        textAnchor="end"
                        height={52}
                        ticks={xLabels}
                      />
                      <YAxis
                        domain={[0, yMax]}
                        tickFormatter={pctFmt}
                        tick={{ fill: "#cbd5e1", fontSize: 12 }}
                        stroke="#334155"
                        allowDecimals={false}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "#0b1220",
                          border: "1px solid #334155",
                          color: "#e5e7eb",
                          borderRadius: 8,
                        }}
                        formatter={(value, name, payload) => {
                          const pct = Number(value);
                          const count = payload?.payload?.count ?? 0;
                          return [
                            `${pct.toFixed(1)}% (${count.toLocaleString()})`,
                            name,
                          ];
                        }}
                        labelFormatter={(label) => label}
                      />
                      {/* No Legend on purpose */}

                      <defs>
                        {orderKeys.map((k) => {
                          const id = `priceFill_${String(k).replace(
                            /\s+/g,
                            "_"
                          )}`;
                          const col = colorForKey(k, orderKeys);
                          return (
                            <linearGradient
                              key={id}
                              id={id}
                              x1="0"
                              y1="0"
                              x2="0"
                              y2="1"
                            >
                              <stop
                                offset="0%"
                                stopColor={col}
                                stopOpacity={0.22}
                              />
                              <stop
                                offset="100%"
                                stopColor={col}
                                stopOpacity={0}
                              />
                            </linearGradient>
                          );
                        })}
                      </defs>

                      {series.map((s) => {
                        const col = colorForKey(s.key, orderKeys); // exact same mapping as scatter
                        const fillId = `url(#priceFill_${String(s.key).replace(
                          /\s+/g,
                          "_"
                        )})`;
                        const name =
                          colorMode === "cluster" ? `C${s.key}` : String(s.key);
                        return (
                          <React.Fragment key={`series-${String(s.key)}`}>
                            <Area
                              type="monotone"
                              name={name}
                              data={s.data}
                              dataKey="pct"
                              fill={fillId}
                              stroke="none"
                              isAnimationActive={false}
                            />
                            <Line
                              type="monotone"
                              name={name}
                              data={s.data}
                              dataKey="pct"
                              stroke={col}
                              strokeWidth={2}
                              dot={false}
                              activeDot={false}
                              isAnimationActive={false}
                            />
                          </React.Fragment>
                        );
                      })}
                    </AreaChart>
                  );
                })()}
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* RIGHT: Geographic map (full height of column) */}
        <div
          style={{
            background: "#111827",
            border: "1px solid #1f2937",
            borderRadius: 12,
            padding: 12,
            minHeight: 640,
            boxSizing: "border-box",
            position: "relative",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {selectedStateName && (
            <button
              onClick={() => setSelectedStateName(null)}
              style={{
                position: "absolute",
                top: 10,
                right: 12,
                background: "#0b1220",
                color: "#e5e7eb",
                border: "1px solid #334155",
                borderRadius: 8,
                padding: "4px 8px",
                fontSize: 12,
                cursor: "pointer",
              }}
              title="Clear state filter"
            >
              Clear
            </button>
          )}

          <div style={{ fontWeight: 700, marginBottom: 8 }}>Geographic map</div>

          <div
            style={{
              flex: 1,
              borderRadius: 8,
              overflow: "hidden",
              minHeight: 0,
            }}
          >
            <ComposableMap
              projection="geoAlbersUsa"
              style={{ width: "100%", height: "100%" }}
            >
              <Geographies geography={US_TOPO}>
                {({ geographies }) =>
                  geographies.map((geo) => {
                    const name = geo.properties.name;

                    const pct = stateAgg.pcts.get(name) || 0;
                    const t =
                      stateAgg.maxPct > 0
                        ? Math.min(1, pct / stateAgg.maxPct)
                        : 0;

                    const isSelected = selectedStateName === name;
                    const baseFill = blendHex("#0b1220", "#FF5432", t);
                    const fill = isSelected
                      ? blendHex(baseFill, "#ffffff", 0.25)
                      : baseFill;
                    const stroke = isSelected ? "#FF5432" : "#1f2937";
                    const strokeWidth = isSelected ? 2 : 0.75;

                    return (
                      <Geography
                        key={geo.rsmKey}
                        geography={geo}
                        onClick={() => setSelectedStateName(name)}
                        onMouseEnter={() =>
                          setHoverState({
                            name,
                            pct,
                            count: stateAgg.counts.get(name) || 0,
                          })
                        }
                        onMouseLeave={() => setHoverState(null)}
                        style={{
                          default: {
                            fill,
                            stroke,
                            strokeWidth,
                            outline: "none",
                            cursor: "pointer",
                          },
                          hover: {
                            fill: blendHex(fill, "#ffffff", 0.15),
                            stroke,
                            strokeWidth: Math.max(1, strokeWidth),
                            outline: "none",
                            cursor: "pointer",
                          },
                          pressed: {
                            fill,
                            stroke,
                            strokeWidth: Math.max(1, strokeWidth),
                            outline: "none",
                          },
                        }}
                      />
                    );
                  })
                }
              </Geographies>
            </ComposableMap>
          </div>

          <div
            style={{
              marginTop: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ fontSize: 12, opacity: 0.85 }}>
              {hoverState
                ? `${hoverState.name}: ${hoverState.pct.toFixed(1)}%${
                    stateAgg.counts.get(hoverState.name) || 0
                      ? ` (${(
                          stateAgg.counts.get(hoverState.name) || 0
                        ).toLocaleString()})`
                      : ""
                  }`
                : selectedStateName
                ? `Filtering Demographics to ${selectedStateName} • ${scopeRows.length.toLocaleString()} records`
                : stateAgg.total > 0
                ? `States shown: ${
                    stateAgg.counts.size
                  } • Records: ${stateAgg.total.toLocaleString()}`
                : "No state data in current scope"}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }} />
          </div>
        </div>
      </div>
    </div>
  );
}
