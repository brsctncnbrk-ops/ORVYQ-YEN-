import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

export type OrvyqGraphicSpec = {
  type: string;
  family?: string;
  kicker?: string;
  title: string;
  subtitle?: string;
  labels?: string[];
  source?: string;
};

const clamp = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };
const ink = "#F5F0E7";
const muted = "#B8B4AC";
const accent = "#D95B53";
const blue = "#86A9CC";

const modeFor = (spec: OrvyqGraphicSpec) => {
  if (["brand_open", "brand_close"].includes(spec.type)) return "brand";
  if (["evaluation", "scenario", "fire_drill", "open_closed", "audit_tradeoff", "defense_balance", "forecast_diverge"].includes(spec.type)) return "comparison";
  if (["report_scan", "compute_threshold"].includes(spec.type)) return "evidence";
  if (["safeguards", "compliance_stack", "sunset"].includes(spec.type)) return "process";
  return "statement";
};

const Mark = () => (
  <div style={{ display: "flex", alignItems: "center", gap: 12, fontFamily: "Arial", letterSpacing: ".28em", fontSize: 19, color: ink }}>
    <span style={{ width: 9, height: 9, borderRadius: 99, background: accent }} />ORVYQ
  </div>
);

const Brand: React.FC<{ spec: OrvyqGraphicSpec; reveal: number }> = ({ spec, reveal }) => (
  <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", textAlign: "center", padding: "7%" }}>
    <div style={{ opacity: reveal, transform: `translateY(${(1 - reveal) * 24}px)` }}>
      <div style={{ color: blue, letterSpacing: ".3em", fontSize: 20, marginBottom: 28 }}>{spec.kicker}</div>
      <div style={{ color: ink, fontSize: spec.type === "brand_close" ? 82 : 94, lineHeight: 1, fontWeight: 760, letterSpacing: "-.04em" }}>{spec.title}</div>
      {spec.subtitle ? <div style={{ color: muted, fontSize: 29, lineHeight: 1.35, marginTop: 28, maxWidth: 1080 }}>{spec.subtitle}</div> : null}
    </div>
  </AbsoluteFill>
);

const Comparison: React.FC<{ spec: OrvyqGraphicSpec; p: number }> = ({ spec, p }) => {
  const labels = spec.labels?.length === 2 ? spec.labels : ["WHAT THE TEST SHOWS", "WHAT IT DOES NOT PROVE"];
  return (
    <div style={{ width: "100%", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 30 }}>
      {labels.map((label, index) => {
        const show = interpolate(p, [0.08 + index * 0.12, 0.42 + index * 0.12], [0, 1], clamp);
        return (
          <div key={label} style={{ minHeight: 260, border: `1px solid ${index ? "rgba(245,240,231,.42)" : blue}`, background: "rgba(7,13,23,.62)", padding: 34, opacity: show, transform: `translateY(${(1 - show) * 20}px)` }}>
            <div style={{ color: index ? muted : blue, fontSize: 18, letterSpacing: ".18em", marginBottom: 26 }}>{index ? "LIMIT" : "MEANING"}</div>
            <div style={{ color: ink, fontSize: 34, lineHeight: 1.2, fontWeight: 680 }}>{label}</div>
          </div>
        );
      })}
    </div>
  );
};

const Evidence: React.FC<{ spec: OrvyqGraphicSpec; p: number }> = ({ spec, p }) => {
  const rows = spec.labels?.length ? spec.labels : ["Published source", "Claim under discussion", "Context and limitation"];
  return (
    <div style={{ width: "100%", maxWidth: 1120, border: "1px solid rgba(245,240,231,.34)", background: "rgba(248,246,240,.055)", padding: 38 }}>
      <div style={{ color: blue, letterSpacing: ".2em", fontSize: 18, marginBottom: 28 }}>SOURCE CONTEXT</div>
      {rows.map((row, index) => {
        const show = interpolate(p, [0.08 + index * 0.1, 0.38 + index * 0.1], [0, 1], clamp);
        return <div key={row} style={{ display: "grid", gridTemplateColumns: "46px 1fr", gap: 20, padding: "18px 0", borderTop: "1px solid rgba(245,240,231,.12)", opacity: show }}><span style={{ color: accent, fontSize: 20 }}>{String(index + 1).padStart(2, "0")}</span><span style={{ color: ink, fontSize: 29, lineHeight: 1.2 }}>{row}</span></div>;
      })}
      {spec.source ? <div style={{ marginTop: 26, color: muted, fontSize: 19 }}>Source: {spec.source}</div> : null}
    </div>
  );
};

const Process: React.FC<{ spec: OrvyqGraphicSpec; p: number }> = ({ spec, p }) => {
  const labels = spec.labels?.length ? spec.labels : ["CONSTRAIN", "AUDIT", "REPORT", "VERIFY"];
  return (
    <div style={{ width: "100%", display: "grid", gridTemplateColumns: `repeat(${labels.length}, 1fr)`, gap: 14, alignItems: "stretch" }}>
      {labels.map((label, index) => {
        const show = interpolate(p, [0.06 + index * 0.1, 0.34 + index * 0.1], [0, 1], clamp);
        return <div key={label} style={{ position: "relative", minHeight: 210, border: "1px solid rgba(245,240,231,.28)", padding: 26, display: "flex", alignItems: "flex-end", background: index % 2 ? "rgba(134,169,204,.09)" : "rgba(217,91,83,.07)", opacity: show }}><span style={{ position: "absolute", top: 20, left: 22, color: index % 2 ? blue : accent, fontSize: 18 }}>0{index + 1}</span><span style={{ color: ink, fontSize: 25, lineHeight: 1.15, letterSpacing: ".06em" }}>{label}</span></div>;
      })}
    </div>
  );
};

const Statement: React.FC<{ spec: OrvyqGraphicSpec; p: number }> = ({ spec, p }) => {
  const signal = spec.labels?.[0] || "CONTEXT";
  const reveal = interpolate(p, [0.06, 0.5], [0, 1], clamp);
  return (
    <div style={{ width: "100%", maxWidth: 1000, minHeight: 330, border: "1px solid rgba(245,240,231,.22)", background: "rgba(7,13,23,.5)", display: "grid", placeItems: "center", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, opacity: 0.22, background: "radial-gradient(circle at center, rgba(134,169,204,.35), transparent 62%)" }} />
      <div style={{ color: ink, fontSize: 138, lineHeight: 0.9, fontWeight: 760, letterSpacing: "-.055em", opacity: reveal, transform: `scale(${0.92 + reveal * 0.08})` }}>{signal}</div>
      <div style={{ position: "absolute", left: 50, right: 50, bottom: 38, height: 3, background: `linear-gradient(90deg,${blue},${accent})`, transform: `scaleX(${reveal})`, transformOrigin: "left" }} />
    </div>
  );
};

export const OrvyqGraphic: React.FC<{ spec: OrvyqGraphicSpec; durationInFrames: number }> = ({ spec, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [0, 1], clamp);
  const reveal = spring({ frame, fps, config: { damping: 20, stiffness: 105, mass: 0.9 }, durationInFrames: Math.min(durationInFrames, 34) });
  const mode = modeFor(spec);

  if (mode === "brand") {
    return <AbsoluteFill style={{ background: "radial-gradient(circle at 50% 42%,#263C53 0%,#0B121D 44%,#05070C 100%)", color: ink }}><Brand spec={spec} reveal={reveal} /></AbsoluteFill>;
  }

  return (
    <AbsoluteFill style={{ background: "linear-gradient(135deg,#101A27 0%,#0C1320 48%,#151C23 100%)", color: ink, padding: "5.2% 6.4%", justifyContent: "space-between" }}>
      <Mark />
      <div style={{ display: "grid", gridTemplateColumns: "minmax(430px,.78fr) minmax(700px,1.22fr)", gap: 64, alignItems: "center", flex: 1 }}>
        <div style={{ opacity: reveal, transform: `translateX(${(1 - reveal) * -28}px)` }}>
          <div style={{ color: blue, letterSpacing: ".2em", fontSize: 18, marginBottom: 22 }}>{spec.kicker || "EDITORIAL CONTEXT"}</div>
          <div style={{ color: ink, fontSize: 52, lineHeight: 1.06, fontWeight: 720, letterSpacing: "-.025em" }}>{spec.title}</div>
          {spec.subtitle ? <div style={{ color: muted, fontSize: 26, lineHeight: 1.38, marginTop: 24 }}>{spec.subtitle}</div> : null}
        </div>
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center" }}>
          {mode === "comparison" ? <Comparison spec={spec} p={p} /> : mode === "evidence" ? <Evidence spec={spec} p={p} /> : mode === "process" ? <Process spec={spec} p={p} /> : <Statement spec={spec} p={p} />}
        </div>
      </div>
    </AbsoluteFill>
  );
};
