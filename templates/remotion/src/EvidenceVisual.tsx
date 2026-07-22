import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

export type EvidenceDataPoint = {
  label: string;
  value?: number;
  value_label?: string;
  detail?: string;
  status?: "strong" | "limited" | "uncertain" | "neutral";
};

export type EvidenceMatrixRow = {
  label: string;
  values: string[];
};

export type EvidenceNode = {
  id: string;
  label: string;
  detail?: string;
};

export type EvidenceVisualSpec = {
  type: "timeline" | "bar_evidence" | "matrix" | "evidence_chain" | "node_map";
  points?: EvidenceDataPoint[];
  columns?: string[];
  rows?: EvidenceMatrixRow[];
  nodes?: EvidenceNode[];
  center_label?: string;
  max_value?: number;
  unit?: string;
};

const ink = "#F5F0E7";
const muted = "#C9C4BA";
const blue = "#86A9CC";
const accent = "#D95B53";
const green = "#8FB59D";

const colorForStatus = (status?: EvidenceDataPoint["status"]) => {
  if (status === "strong") return green;
  if (status === "limited") return blue;
  if (status === "uncertain") return accent;
  return muted;
};

const Timeline: React.FC<{ spec: EvidenceVisualSpec; progress: number }> = ({ spec, progress }) => {
  const points = spec.points || [];
  return (
    <div style={{ display: "grid", gap: 15, marginTop: 22 }}>
      {points.map((point, index) => {
        const local = interpolate(progress, [index / Math.max(1, points.length), Math.min(1, (index + 1.2) / Math.max(1, points.length))], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        return (
          <div key={`${point.label}-${index}`} style={{ display: "grid", gridTemplateColumns: "92px 18px 1fr", gap: 14, alignItems: "start", opacity: local, transform: `translateX(${(1 - local) * 22}px)` }}>
            <div style={{ color: blue, fontSize: 20, fontWeight: 820, letterSpacing: ".04em" }}>{point.value_label || point.label}</div>
            <div style={{ display: "grid", justifyItems: "center" }}>
              <span style={{ width: 12, height: 12, borderRadius: 99, background: colorForStatus(point.status), boxShadow: `0 0 0 5px rgba(134,169,204,.12)` }} />
              {index < points.length - 1 ? <span style={{ width: 1, height: 46, background: "rgba(245,240,231,.23)" }} /> : null}
            </div>
            <div>
              <div style={{ color: ink, fontSize: 25, lineHeight: 1.15, fontWeight: 720 }}>{point.label}</div>
              {point.detail ? <div style={{ color: muted, fontSize: 19, lineHeight: 1.25, marginTop: 5 }}>{point.detail}</div> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const BarEvidence: React.FC<{ spec: EvidenceVisualSpec; progress: number }> = ({ spec, progress }) => {
  const points = spec.points || [];
  const maxValue = spec.max_value || Math.max(1, ...points.map((point) => Number(point.value || 0)));
  return (
    <div style={{ display: "grid", gap: 14, marginTop: 24 }}>
      {points.map((point, index) => {
        const local = interpolate(progress, [index * 0.08, Math.min(1, 0.45 + index * 0.08)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        const fraction = Math.max(0, Math.min(1, Number(point.value || 0) / maxValue));
        return (
          <div key={`${point.label}-${index}`}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 20, marginBottom: 7 }}>
              <span style={{ color: ink, fontSize: 22, lineHeight: 1.15, fontWeight: 680 }}>{point.label}</span>
              <span style={{ color: blue, fontSize: 22, fontWeight: 820 }}>{point.value_label || `${point.value ?? ""}${spec.unit || ""}`}</span>
            </div>
            <div style={{ height: 11, background: "rgba(245,240,231,.12)", overflow: "hidden" }}>
              <div style={{ width: `${fraction * local * 100}%`, height: "100%", background: `linear-gradient(90deg,${blue},${colorForStatus(point.status)})` }} />
            </div>
            {point.detail ? <div style={{ color: muted, fontSize: 17, lineHeight: 1.22, marginTop: 6 }}>{point.detail}</div> : null}
          </div>
        );
      })}
    </div>
  );
};

const Matrix: React.FC<{ spec: EvidenceVisualSpec; progress: number }> = ({ spec, progress }) => {
  const columns = spec.columns || [];
  const rows = spec.rows || [];
  return (
    <div style={{ display: "grid", gap: 1, background: "rgba(245,240,231,.16)", marginTop: 22, border: "1px solid rgba(245,240,231,.16)" }}>
      <div style={{ display: "grid", gridTemplateColumns: `1.1fr repeat(${columns.length}, 1fr)`, gap: 1 }}>
        <div style={{ background: "rgba(7,13,20,.96)", padding: "12px 14px" }} />
        {columns.map((column) => <div key={column} style={{ background: "rgba(19,35,49,.96)", color: blue, padding: "12px 14px", fontSize: 17, fontWeight: 820, letterSpacing: ".05em" }}>{column}</div>)}
      </div>
      {rows.map((row, index) => {
        const local = interpolate(progress, [index * 0.08, Math.min(1, 0.5 + index * 0.08)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        return (
          <div key={row.label} style={{ display: "grid", gridTemplateColumns: `1.1fr repeat(${columns.length}, 1fr)`, gap: 1, opacity: local }}>
            <div style={{ background: "rgba(7,13,20,.96)", color: ink, padding: "13px 14px", fontSize: 18, lineHeight: 1.15, fontWeight: 720 }}>{row.label}</div>
            {row.values.map((value, valueIndex) => <div key={`${row.label}-${valueIndex}`} style={{ background: "rgba(12,22,32,.94)", color: muted, padding: "13px 14px", fontSize: 17, lineHeight: 1.2 }}>{value}</div>)}
          </div>
        );
      })}
    </div>
  );
};

const EvidenceChain: React.FC<{ spec: EvidenceVisualSpec; progress: number }> = ({ spec, progress }) => {
  const points = spec.points || [];
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(1, points.length)}, minmax(0,1fr))`, gap: 9, alignItems: "stretch", marginTop: 23 }}>
      {points.map((point, index) => {
        const local = interpolate(progress, [index / Math.max(1, points.length), Math.min(1, (index + 1.3) / Math.max(1, points.length))], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        return (
          <div key={`${point.label}-${index}`} style={{ position: "relative", border: `1px solid ${colorForStatus(point.status)}88`, background: "rgba(8,16,25,.82)", padding: "15px 12px", minHeight: 132, opacity: local, transform: `translateY(${(1 - local) * 18}px)` }}>
            <div style={{ color: colorForStatus(point.status), fontSize: 15, fontWeight: 900, letterSpacing: ".08em" }}>{String(index + 1).padStart(2, "0")}</div>
            <div style={{ color: ink, fontSize: 20, lineHeight: 1.12, fontWeight: 740, marginTop: 8 }}>{point.label}</div>
            {point.detail ? <div style={{ color: muted, fontSize: 15, lineHeight: 1.22, marginTop: 8 }}>{point.detail}</div> : null}
            {index < points.length - 1 ? <div style={{ position: "absolute", right: -9, top: "50%", width: 9, height: 1, background: "rgba(245,240,231,.42)" }} /> : null}
          </div>
        );
      })}
    </div>
  );
};

const NodeMap: React.FC<{ spec: EvidenceVisualSpec; progress: number }> = ({ spec, progress }) => {
  const nodes = spec.nodes || [];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 170px 1fr", gap: 18, alignItems: "center", marginTop: 23 }}>
      <div style={{ display: "grid", gap: 12 }}>{nodes.filter((_, index) => index % 2 === 0).map((node, index) => <Node key={node.id} node={node} index={index} progress={progress} />)}</div>
      <div style={{ width: 150, height: 150, borderRadius: 999, border: `2px solid ${blue}`, display: "grid", placeItems: "center", textAlign: "center", color: ink, fontSize: 24, fontWeight: 820, background: "radial-gradient(circle,rgba(44,76,100,.88),rgba(8,15,23,.96))", boxShadow: "0 0 50px rgba(134,169,204,.16)" }}>{spec.center_label || "SYSTEM"}</div>
      <div style={{ display: "grid", gap: 12 }}>{nodes.filter((_, index) => index % 2 === 1).map((node, index) => <Node key={node.id} node={node} index={index + 1} progress={progress} />)}</div>
    </div>
  );
};

const Node: React.FC<{ node: EvidenceNode; index: number; progress: number }> = ({ node, index, progress }) => {
  const local = interpolate(progress, [index * 0.08, Math.min(1, 0.52 + index * 0.08)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <div style={{ border: "1px solid rgba(134,169,204,.38)", background: "rgba(8,16,25,.82)", padding: "12px 14px", opacity: local, transform: `scale(${0.94 + local * 0.06})` }}><div style={{ color: ink, fontSize: 20, fontWeight: 760 }}>{node.label}</div>{node.detail ? <div style={{ color: muted, fontSize: 15, lineHeight: 1.18, marginTop: 5 }}>{node.detail}</div> : null}</div>;
};

export const EvidenceVisual: React.FC<{ spec: EvidenceVisualSpec; durationInFrames: number }> = ({ spec, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = spring({ frame, fps, config: { damping: 25, stiffness: 82, mass: 1 }, durationInFrames: Math.min(durationInFrames, 42) });
  if (spec.type === "timeline") return <Timeline spec={spec} progress={progress} />;
  if (spec.type === "bar_evidence") return <BarEvidence spec={spec} progress={progress} />;
  if (spec.type === "matrix") return <Matrix spec={spec} progress={progress} />;
  if (spec.type === "evidence_chain") return <EvidenceChain spec={spec} progress={progress} />;
  return <NodeMap spec={spec} progress={progress} />;
};
