// Shared SVG chart primitives for the reporting screens — same visual
// language as Analytics (hairline grid, rounded columns, labels under the
// baseline, no axis furniture, no charting library). Every chart takes plain
// numbers so the screens stay presentational and the math stays testable.
import React, { useId, useState } from "react";
import { View } from "react-native";
import { Text } from "./InterText";
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop, Text as SvgText } from "react-native-svg";
import { fonts } from "../theme";

const TXT2 = "#9a9a9e";
const TXT3 = "#6e6e73";
const GRID = "rgba(255,255,255,0.07)";

export type ChartPoint = { label: string; value: number };

/** Catmull-Rom → cubic bezier: the calm S-curve the credit cards use. */
function smoothPath(pts: { x: number; y: number }[]): string {
  if (!pts.length) return "";
  if (pts.length < 3) return pts.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

/**
 * Smooth line + fading gradient fill over faint vertical guides — no dots,
 * no axis furniture. `yMin`/`yMax` pin the scale (e.g. 0–100%).
 */
export function LineChart({
  points,
  color,
  height = 170,
  yMin,
  yMax,
  endDot = false,
}: {
  points: ChartPoint[];
  color: string;
  height?: number;
  yMin?: number;
  yMax?: number;
  /** Filled dot on the last point (the health mock's live-edge marker). */
  endDot?: boolean;
}) {
  const [w, setW] = useState(0);
  const gradId = `lc-${useId().replace(/[^a-z0-9]/gi, "")}`;
  const n = points.length;
  const TOP = 14;
  const BASE = height - 8;
  const vals = points.map(p => p.value);
  const rawMax = yMax ?? (n ? Math.max(...vals) : 1);
  const rawMin = yMin ?? (n ? Math.min(...vals) : 0);
  let max = rawMax;
  let min = rawMin;
  if (max - min < 1e-6) { max = min + 1; min = Math.max(0, min - 1); }
  const x = (i: number) => (n <= 1 ? w / 2 : (i / (n - 1)) * w);
  const y = (v: number) => BASE - ((v - min) / (max - min)) * (BASE - TOP);
  const pts = points.map((p, i) => ({ x: x(i), y: y(p.value) }));
  const line = smoothPath(pts);
  const area = n >= 2 ? `${line} L${pts[n - 1].x.toFixed(1)},${BASE} L${pts[0].x.toFixed(1)},${BASE} Z` : "";
  return (
    <View style={{ height }} onLayout={e => setW(e.nativeEvent.layout.width)}>
      {w > 0 && n > 0 ? (
        <Svg width={w} height={height}>
          <Defs>
            <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color} stopOpacity="0.32" />
              <Stop offset="1" stopColor={color} stopOpacity="0" />
            </LinearGradient>
          </Defs>
          {pts.map((p, i) => (
            <Rect key={`g${i}`} x={p.x - 0.25} y={TOP} width={0.5} height={BASE - TOP} fill={GRID} />
          ))}
          {n >= 2 ? <Path d={area} fill={`url(#${gradId})`} /> : null}
          {n >= 2 ? (
            <Path d={line} fill="none" stroke={color} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
          ) : (
            <Circle cx={pts[0].x} cy={pts[0].y} r={5} fill={color} />
          )}
          {n >= 2 && endDot ? <Circle cx={pts[n - 1].x} cy={pts[n - 1].y} r={5.5} fill={color} /> : null}
        </Svg>
      ) : null}
    </View>
  );
}

export type ChartBar = { label: string; value: number; sub?: string; color: string };

/** Column chart: value above each bar, label (and optional sub) below. */
export function ColumnChart({
  bars,
  format,
  height = 170,
}: {
  bars: ChartBar[];
  format: (v: number) => string;
  height?: number;
}) {
  const [w, setW] = useState(0);
  const n = Math.max(1, bars.length);
  const hasSub = bars.some(b => b.sub);
  const BOTTOM = hasSub ? 32 : 18;
  const BASE = height - BOTTOM;
  const max = Math.max(1, ...bars.map(b => b.value));
  const colW = w / n;
  const barW = Math.min(46, Math.max(18, colW * 0.46));
  const maxH = BASE - 22;
  return (
    <View style={{ height }} onLayout={e => setW(e.nativeEvent.layout.width)}>
      {w > 0 ? (
        <Svg width={w} height={height}>
          <Rect x={0} y={BASE} width={w} height={0.5} fill={GRID} />
          {bars.map((b, i) => {
            const h = b.value > 0 ? Math.max(5, (b.value / max) * maxH) : 2;
            const cx = i * colW + colW / 2;
            const x = cx - barW / 2;
            const rx = Math.min(8, barW / 2);
            return (
              <React.Fragment key={`${b.label}-${i}`}>
                <Rect x={x - 4} y={BASE - maxH} width={barW + 8} height={maxH + 4} rx={rx} fill="rgba(255,255,255,0.045)" />
                <Rect x={x} y={BASE - h} width={barW} height={h} rx={rx} fill={b.value > 0 ? b.color : "rgba(255,255,255,0.18)"} />
                {b.value > 0 ? (
                  <SvgText fontFamily={fonts.bold} x={cx} y={BASE - h - 7} fontSize={11} fontWeight="800" fill="#fff" textAnchor="middle">
                    {format(b.value)}
                  </SvgText>
                ) : null}
                <SvgText fontFamily={fonts.bold} x={cx} y={BASE + 15} fontSize={11} fontWeight="700" fill={TXT2} textAnchor="middle">{b.label}</SvgText>
                {b.sub ? (
                  <SvgText fontFamily={fonts.semibold} x={cx} y={BASE + 28} fontSize={10} fontWeight="600" fill={TXT3} textAnchor="middle">{b.sub}</SvgText>
                ) : null}
              </React.Fragment>
            );
          })}
        </Svg>
      ) : null}
    </View>
  );
}

/** Paired columns per month (e.g. issued vs repaid) with labels below. */
export function GroupedBars({
  groups,
  colors,
  format,
  height = 160,
}: {
  groups: { label: string; values: number[] }[];
  colors: string[];
  format: (v: number) => string;
  height?: number;
}) {
  const [w, setW] = useState(0);
  const n = Math.max(1, groups.length);
  const per = Math.max(1, colors.length);
  const BASE = height - 18;
  const max = Math.max(1, ...groups.flatMap(g => g.values));
  const colW = w / n;
  const pairW = Math.min(56, colW * 0.66);
  const barW = Math.max(6, (pairW - (per - 1) * 3) / per);
  const maxH = BASE - 20;
  return (
    <View style={{ height }} onLayout={e => setW(e.nativeEvent.layout.width)}>
      {w > 0 ? (
        <Svg width={w} height={height}>
          <Rect x={0} y={BASE} width={w} height={0.5} fill={GRID} />
          {groups.map((g, i) => {
            const start = i * colW + (colW - pairW) / 2;
            return (
              <React.Fragment key={`${g.label}-${i}`}>
                {g.values.map((v, j) => {
                  const h = v > 0 ? Math.max(4, (v / max) * maxH) : 1.5;
                  const x = start + j * (barW + 3);
                  return (
                    <Rect
                      key={j}
                      x={x}
                      y={BASE - h}
                      width={barW}
                      height={h}
                      rx={Math.min(4, barW / 2)}
                      fill={v > 0 ? colors[j] : "rgba(255,255,255,0.16)"}
                    />
                  );
                })}
                <SvgText fontFamily={fonts.semibold} x={i * colW + colW / 2} y={BASE + 15} fontSize={10.5} fontWeight="600" fill={TXT2} textAnchor="middle">
                  {g.label}
                </SvgText>
              </React.Fragment>
            );
          })}
        </Svg>
      ) : null}
    </View>
  );
}

/**
 * Payment pattern: rounded columns (amount paid) with a smooth line on a
 * second scale (days to clear). `line` is index-aligned with `bars`; null
 * entries are skipped. No axis furniture — the legend under the card names
 * the two series.
 */
export function ComboChart({
  bars,
  line,
  barColor,
  lineColor,
  height = 190,
}: {
  bars: ChartPoint[];
  line: (number | null)[];
  barColor: string;
  lineColor: string;
  height?: number;
}) {
  const [w, setW] = useState(0);
  const n = Math.max(1, bars.length);
  const TOP = 18;
  const BOTTOM = 26;
  const BASE = height - BOTTOM;
  const colW = w / n;
  const barW = Math.min(34, Math.max(14, colW * 0.42));
  const maxBar = Math.max(1, ...bars.map(b => b.value));
  const lineVals = line.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const maxLine = Math.max(1, ...lineVals);
  const cx = (i: number) => i * colW + colW / 2;
  const pts = bars
    .map((b, i) => {
      const v = line[i];
      if (typeof v !== "number" || !Number.isFinite(v)) return null;
      return { x: cx(i), y: BASE - (v / maxLine) * (BASE - TOP) };
    })
    .filter((p): p is { x: number; y: number } => p !== null);
  const linePath = pts.length >= 2 ? smoothPath(pts) : "";
  return (
    <View style={{ height }} onLayout={e => setW(e.nativeEvent.layout.width)}>
      {w > 0 ? (
        <Svg width={w} height={height}>
          {bars.map((b, i) => (
            <Rect key={`g${i}`} x={cx(i) - 0.25} y={TOP} width={0.5} height={BASE - TOP} fill={GRID} />
          ))}
          <Rect x={0} y={BASE} width={w} height={0.5} fill={GRID} />
          {bars.map((b, i) => {
            const h = b.value > 0 ? Math.max(5, (b.value / maxBar) * (BASE - TOP)) : 2;
            const x = cx(i) - barW / 2;
            return (
              <React.Fragment key={`b${b.label}-${i}`}>
                <Rect x={x} y={BASE - h} width={barW} height={h} rx={Math.min(7, barW / 2)} fill={b.value > 0 ? barColor : "rgba(255,255,255,0.16)"} />
                <SvgText fontFamily={fonts.semibold} x={cx(i)} y={BASE + 16} fontSize={10} fontWeight="600" fill={TXT2} textAnchor="middle">
                  {b.label}
                </SvgText>
              </React.Fragment>
            );
          })}
          {linePath ? (
            <Path d={linePath} fill="none" stroke={lineColor} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
          ) : null}
          {pts.length === 1 ? <Circle cx={pts[0].x} cy={pts[0].y} r={5} fill={lineColor} /> : null}
        </Svg>
      ) : null}
    </View>
  );
}

/** Small legend row used under a chart. */
export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16, marginTop: 8 }}>
      {items.map(it => (
        <View key={it.label} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: it.color }} />
          <Text style={{ fontSize: 11, fontWeight: "600", color: TXT2 }}>{it.label}</Text>
        </View>
      ))}
    </View>
  );
}
