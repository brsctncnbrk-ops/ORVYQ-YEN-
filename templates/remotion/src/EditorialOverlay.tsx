import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { EvidenceDataPoint, EvidenceMatrixRow, EvidenceNode, EvidenceVisual, EvidenceVisualSpec } from "./EvidenceVisual";

export type EditorialOverlaySpec = {
  type: "source_mosaic" | "comparison" | "document" | "stat" | "process" | "email_recreation" | "quote" | "boundary" | "timeline" | "bar_evidence" | "matrix" | "evidence_chain" | "node_map";
  eyebrow: string;
  title: string;
  body?: string;
  limitation?: string;
  items?: string[];
  steps?: string[];
  left?: string;
  right?: string;
  recreation_label?: string;
  source_ids?: string[];
  font_px?: number;
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
const accent = "#D95B53";
const blue = "#86A9CC";
const clamp = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };
const EVIDENCE_TYPES = new Set(["timeline", "bar_evidence", "matrix", "evidence_chain", "node_map"]);

const SourceFooter: React.FC<{ spec: EditorialOverlaySpec }> = ({ spec }) => {
  const label = spec.recreation_label || ((spec.source_ids || []).length ? "PRIMARY SOURCE CONTEXT" : null);
  if (!label) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 20, color: muted, fontSize: 17, letterSpacing: ".13em", fontWeight: 700 }}>
      <span style={{ width: 7, height: 7, borderRadius: 99, background: blue }} />
      {label}
    </div>
  );
};

const Comparison: React.FC<{ spec: EditorialOverlaySpec }> = ({ spec }) => (
  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 22 }}>
    {[spec.left, spec.right].map((value, index) => (
      <div key={`${index}-${value}`} style={{ border: `1px solid ${index ? "rgba(245,240,231,.28)" : "rgba(134,169,204,.72)"}`, background: index ? "rgba(10,15,22,.72)" : "rgba(24,43,60,.76)", padding: "18px 20px", minHeight: 94, display: "flex", alignItems: "center" }}>
        <div style={{ color: index ? muted : ink, fontSize: 27, lineHeight: 1.18, fontWeight: 680 }}>{value}</div>
      </div>
    ))}
  </div>
);

const SourceMosaic: React.FC<{ spec: EditorialOverlaySpec }> = ({ spec }) => (
  <div style={{ display: "grid", gap: 10, marginTop: 20 }}>
    {(spec.items || []).map((item, index) => (
      <div key={item} style={{ display: "grid", gridTemplateColumns: "36px 1fr", gap: 12, alignItems: "center", borderTop: "1px solid rgba(245,240,231,.18)", paddingTop: 13 }}>
        <span style={{ color: blue, fontSize: 18, fontWeight: 800 }}>{String(index + 1).padStart(2, "0")}</span>
        <span style={{ color: ink, fontSize: 25, lineHeight: 1.18, fontWeight: 650 }}>{item}</span>
      </div>
    ))}
  </div>
);

const Process: React.FC<{ spec: EditorialOverlaySpec }> = ({ spec }) => (
  <div style={{ display: "grid", gap: 9, marginTop: 18 }}>
    {(spec.steps || []).map((step, index) => (
      <div key={step} style={{ display: "grid", gridTemplateColumns: "42px 1fr", gap: 12, alignItems: "center", background: "rgba(12,22,33,.75)", border: "1px solid rgba(134,169,204,.25)", padding: "12px 16px" }}>
        <span style={{ width: 28, height: 28, display: "grid", placeItems: "center", borderRadius: 99, background: index === (spec.steps || []).length - 1 ? accent : blue, color: "#07101A", fontSize: 16, fontWeight: 900 }}>{index + 1}</span>
        <span style={{ color: ink, fontSize: 24, lineHeight: 1.18, fontWeight: 650 }}>{step}</span>
      </div>
    ))}
  </div>
);

const EmailRecreation: React.FC<{ spec: EditorialOverlaySpec }> = ({ spec }) => (
  <div style={{ marginTop: 20, border: "1px solid rgba(245,240,231,.28)", background: "rgba(246,244,237,.94)", color: "#111820", boxShadow: "0 24px 70px rgba(0,0,0,.4)" }}>
    <div style={{ padding: "12px 17px", borderBottom: "1px solid rgba(17,24,32,.16)", fontSize: 17, letterSpacing: ".12em", fontWeight: 800, color: "#4D5964" }}>SYNTHETIC CORPORATE EMAIL</div>
    <div style={{ padding: "17px 20px 20px" }}>
      <div style={{ fontSize: 25, lineHeight: 1.15, fontWeight: 820 }}>{spec.title}</div>
      {spec.body ? <div style={{ fontSize: 23, lineHeight: 1.3, marginTop: 12, color: "#26313B" }}>{spec.body}</div> : null}
    </div>
  </div>
);

const DefaultBody: React.FC<{ spec: EditorialOverlaySpec }> = ({ spec }) => (
  <>
    {spec.type === "stat" ? <div style={{ color: ink, fontSize: 76, lineHeight: .95, fontWeight: 850, letterSpacing: "-.045em", marginTop: 18 }}>{spec.title}</div> : null}
    {spec.body ? <div style={{ color: ink, fontSize: Math.max(28, spec.font_px || 30), lineHeight: 1.27, fontWeight: spec.type === "quote" ? 680 : 560, marginTop: spec.type === "stat" ? 18 : 20 }}>{spec.body}</div> : null}
  </>
);

export const EditorialOverlay: React.FC<{ spec: EditorialOverlaySpec; durationInFrames: number }> = ({ spec, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const reveal = spring({ frame, fps, config: { damping: 22, stiffness: 100, mass: .9 }, durationInFrames: Math.min(34, durationInFrames) });
  const fadeOut = interpolate(frame, [Math.max(1, durationInFrames - 13), durationInFrames], [1, 0], clamp);
  const opacity = reveal * fadeOut;
  const titleIsRepeatedInside = spec.type === "stat" || spec.type === "email_recreation";
  const isEvidenceVisual = EVIDENCE_TYPES.has(spec.type);
  const width = isEvidenceVisual ? 980 : 760;

  return (
    <div style={{ position: "absolute", left: 70, top: 62, width, maxHeight: 790, opacity, transform: `translateY(${(1 - reveal) * 24}px)`, fontFamily: "Arial, Helvetica, sans-serif", zIndex: 8 }}>
      <div style={{ position: "absolute", inset: -18, background: "linear-gradient(135deg,rgba(5,10,16,.94),rgba(12,22,32,.84))", border: "1px solid rgba(245,240,231,.2)", boxShadow: "0 28px 90px rgba(0,0,0,.52)", backdropFilter: "blur(15px)" }} />
      <div style={{ position: "relative", padding: "22px 25px 23px" }}>
        <div style={{ color: blue, fontSize: 18, lineHeight: 1.15, fontWeight: 800, letterSpacing: ".17em" }}>{spec.eyebrow}</div>
        {!titleIsRepeatedInside ? <div style={{ color: ink, fontSize: Math.max(34, (spec.font_px || 30) + 5), lineHeight: 1.04, fontWeight: 820, letterSpacing: "-.025em", marginTop: 13 }}>{spec.title}</div> : null}
        {spec.type === "source_mosaic" ? <SourceMosaic spec={spec} /> : null}
        {spec.type === "comparison" ? <Comparison spec={spec} /> : null}
        {spec.type === "process" ? <Process spec={spec} /> : null}
        {spec.type === "email_recreation" ? <EmailRecreation spec={spec} /> : null}
        {["document", "stat", "quote", "boundary"].includes(spec.type) ? <DefaultBody spec={spec} /> : null}
        {isEvidenceVisual ? <EvidenceVisual spec={spec as EvidenceVisualSpec} durationInFrames={durationInFrames} /> : null}
        {spec.limitation ? <div style={{ marginTop: 18, borderLeft: `4px solid ${accent}`, background: "rgba(217,91,83,.12)", color: ink, padding: "12px 15px", fontSize: 22, lineHeight: 1.22, fontWeight: 720 }}>{spec.limitation}</div> : null}
        <SourceFooter spec={spec} />
      </div>
    </div>
  );
};
