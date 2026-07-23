import React from "react";
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { PrimaryEvidenceSpec, EvidenceFocus, EvidenceItem } from "./types/evidence";

const INK = "#F6F2E9";
const MUTED = "#BBC4CE";
const BLUE = "#88ADD1";
const RED = "#D86760";
const GROUND = "#07101A";
const clamp = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };

const Surface: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ background: "linear-gradient(145deg,rgba(18,29,43,.97),rgba(7,14,23,.96))", border: "1px solid rgba(246,242,233,.17)", borderRadius: 12, boxShadow: "0 28px 90px rgba(0,0,0,.46)", overflow: "hidden", ...style }}>{children}</div>
);

const SourceFooter: React.FC<{ spec: PrimaryEvidenceSpec }> = ({ spec }) => (
  <div style={{ position: "absolute", left: 68, right: 68, bottom: 139, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, color: MUTED, fontFamily: "Arial, Helvetica, sans-serif", fontSize: 17, lineHeight: 1.15, letterSpacing: ".075em", textTransform: "uppercase", fontWeight: 760 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
      <span style={{ width: 8, height: 8, borderRadius: 99, background: BLUE, flex: "0 0 auto", boxShadow: "0 0 0 5px rgba(136,173,209,.10)" }} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{spec.source_label}</span>
    </div>
    <span style={{ color: "rgba(246,242,233,.43)", whiteSpace: "nowrap" }}>OFFICIAL SOURCE / SOURCE-DERIVED</span>
  </div>
);

const Limitation: React.FC<{ text?: string }> = ({ text }) => text ? (
  <div style={{ position: "absolute", left: 68, right: 68, bottom: 176, borderLeft: `4px solid ${RED}`, background: "rgba(216,103,96,.13)", color: INK, padding: "10px 15px 11px", fontFamily: "Arial, Helvetica, sans-serif", fontSize: 20, lineHeight: 1.18, fontWeight: 720, boxShadow: "0 12px 34px rgba(0,0,0,.24)" }}>{text}</div>
) : null;

const Header: React.FC<{ spec: PrimaryEvidenceSpec }> = ({ spec }) => (
  <div style={{ position: "absolute", left: 68, right: 68, top: 43, zIndex: 8, fontFamily: "Arial, Helvetica, sans-serif" }}>
    <div style={{ color: BLUE, fontSize: 18, lineHeight: 1.1, letterSpacing: ".16em", fontWeight: 850 }}>{spec.eyebrow}</div>
    <div style={{ color: INK, fontSize: Math.max(38, (spec.font_px || 31) + 8), lineHeight: 1.01, letterSpacing: "-.033em", fontWeight: 860, marginTop: 11, maxWidth: 1680 }}>{spec.title}</div>
    {spec.subtitle ? <div style={{ color: MUTED, fontSize: 24, lineHeight: 1.2, fontWeight: 560, marginTop: 10, maxWidth: 1480 }}>{spec.subtitle}</div> : null}
  </div>
);

const EvidenceImage: React.FC<{ src: string; progress: number; focus?: EvidenceFocus; contain?: boolean; style?: React.CSSProperties }> = ({ src, progress, focus, contain = true, style }) => {
  const scale = interpolate(progress, [0, 1], [1, focus?.scale ?? (contain ? 1.055 : 1.08)], clamp);
  const x = interpolate(progress, [0, 1], [0, focus?.x ?? 0], clamp);
  const y = interpolate(progress, [0, 1], [0, focus?.y ?? 0], clamp);
  return (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", border: "1px solid rgba(246,242,233,.19)", background: contain ? "#EEECE6" : "#101720", boxShadow: "0 26px 86px rgba(0,0,0,.52)", ...style }}>
      <Img src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: contain ? "contain" : "cover", objectPosition: "center", transform: `translate(${x}%,${y}%) scale(${scale})`, filter: "contrast(1.035) saturate(.96)" }} />
    </div>
  );
};

const DocumentStage: React.FC<{ spec: PrimaryEvidenceSpec; progress: number }> = ({ spec, progress }) => {
  const src = (spec.image_assets || [])[0];
  const focus = spec.focus || { scale: 1.13, x: 0, y: -3 };
  return (
    <div style={{ position: "absolute", left: 68, right: 68, top: 178, bottom: spec.limitation ? 244 : 184, display: "grid", gridTemplateColumns: spec.callout ? "1.6fr .72fr" : "1fr", gap: 24 }}>
      <div style={{ position: "relative", overflow: "hidden", borderRadius: 11 }}>
        <Img src={staticFile(src)} style={{ position: "absolute", inset: -50, width: "calc(100% + 100px)", height: "calc(100% + 100px)", objectFit: "cover", filter: "blur(25px) brightness(.28) saturate(.65)", transform: "scale(1.12)" }} />
        <div style={{ position: "absolute", inset: 18 }}><EvidenceImage src={src} progress={progress} focus={focus} contain style={{ borderRadius: 8 }} /></div>
      </div>
      {spec.callout ? (
        <Surface style={{ display: "flex", alignItems: "center", padding: "34px 30px" }}>
          <div>
            <div style={{ color: BLUE, fontFamily: "Arial, Helvetica, sans-serif", fontSize: 17, letterSpacing: ".14em", fontWeight: 850 }}>WHY THIS PAGE MATTERS</div>
            <div style={{ color: INK, fontFamily: "Arial, Helvetica, sans-serif", fontSize: 30, lineHeight: 1.22, fontWeight: 730, marginTop: 18 }}>{spec.callout}</div>
          </div>
        </Surface>
      ) : null}
    </div>
  );
};

const SplitDocuments: React.FC<{ spec: PrimaryEvidenceSpec; progress: number }> = ({ spec, progress }) => (
  <div style={{ position: "absolute", left: 88, right: 88, top: 190, bottom: spec.limitation ? 244 : 184 }}>
    <div style={{ position: "absolute", left: 50, top: 4, width: "47%", height: "96%", transform: `rotate(-1.5deg) translateY(${interpolate(progress, [0, 1], [12, 0], clamp)}px)` }}><EvidenceImage src={(spec.image_assets || [])[0]} progress={progress} focus={{ scale: 1.055, x: .3, y: -1.2 }} contain style={{ borderRadius: 9 }} /></div>
    <div style={{ position: "absolute", right: 50, top: 4, width: "47%", height: "96%", transform: `rotate(1.5deg) translateY(${interpolate(progress, [0, 1], [18, 0], clamp)}px)` }}><EvidenceImage src={(spec.image_assets || [])[1]} progress={progress} focus={{ scale: 1.065, x: -.3, y: -1.2 }} contain style={{ borderRadius: 9 }} /></div>
  </div>
);

const FigureStage: React.FC<{ spec: PrimaryEvidenceSpec; progress: number }> = ({ spec, progress }) => (
  <div style={{ position: "absolute", left: 68, right: 68, top: 174, bottom: spec.limitation ? 244 : 184 }}>
    <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 50% 50%,rgba(136,173,209,.12),transparent 62%)" }} />
    <div style={{ position: "absolute", inset: 10 }}><EvidenceImage src={(spec.image_assets || [])[0]} progress={progress} focus={spec.focus} contain style={{ borderRadius: 10 }} /></div>
    {spec.callout ? <div style={{ position: "absolute", right: 34, bottom: 34, maxWidth: 620, background: "rgba(5,10,17,.91)", border: "1px solid rgba(246,242,233,.23)", borderLeft: `5px solid ${BLUE}`, color: INK, padding: "18px 21px", fontFamily: "Arial, Helvetica, sans-serif", fontSize: 23, lineHeight: 1.22, fontWeight: 690 }}>{spec.callout}</div> : null}
  </div>
);

const ScreenStage: React.FC<{ spec: PrimaryEvidenceSpec; progress: number }> = ({ spec, progress }) => (
  <div style={{ position: "absolute", left: 68, right: 68, top: 174, bottom: spec.limitation ? 244 : 184, background: "#E7E5DF", borderRadius: 10, overflow: "hidden", boxShadow: "0 28px 90px rgba(0,0,0,.54)" }}>
    <EvidenceImage src={(spec.image_assets || [])[0]} progress={progress} focus={spec.focus || { scale: 1.035, x: 0, y: 0 }} contain style={{ borderRadius: 10 }} />
  </div>
);

const ImageSequence: React.FC<{ spec: PrimaryEvidenceSpec; progress: number }> = ({ spec, progress }) => (
  <div style={{ position: "absolute", left: 68, right: 68, top: 187, bottom: spec.limitation ? 244 : 184, display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 14 }}>
    {(spec.image_assets || []).slice(0, 4).map((asset, index) => (
      <div key={asset} style={{ position: "relative", overflow: "hidden", border: "1px solid rgba(246,242,233,.18)", borderRadius: 9, boxShadow: "0 20px 55px rgba(0,0,0,.35)" }}>
        <Img src={staticFile(asset)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${interpolate(progress, [0, 1], [1.015, 1.045], clamp)})`, filter: "contrast(1.035) saturate(.94)" }} />
        <div style={{ position: "absolute", left: 12, top: 10, width: 31, height: 31, borderRadius: 99, display: "grid", placeItems: "center", background: "rgba(7,16,26,.94)", border: `1px solid ${BLUE}`, color: INK, fontFamily: "Arial, Helvetica, sans-serif", fontSize: 16, fontWeight: 850 }}>{index + 1}</div>
      </div>
    ))}
  </div>
);

const Cards: React.FC<{ items: EvidenceItem[]; reveal: number }> = ({ items, reveal }) => (
  <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(1, items.length)},1fr)`, gap: 18, width: "100%", height: "100%" }}>
    {items.map((item, index) => {
      const local = interpolate(reveal, [index / Math.max(1, items.length), Math.min(1, (index + 1.15) / Math.max(1, items.length))], [0, 1], clamp);
      return <Surface key={`${item.label}-${item.value}`} style={{ opacity: local, transform: `translateY(${(1 - local) * 24}px)`, padding: "25px 23px", display: "flex", flexDirection: "column" }}><div style={{ color: BLUE, fontFamily: "Arial, Helvetica, sans-serif", fontSize: 18, letterSpacing: ".12em", fontWeight: 850 }}>{item.label}</div><div style={{ color: INK, fontFamily: "Arial, Helvetica, sans-serif", fontSize: 30, lineHeight: 1.06, fontWeight: 820, marginTop: 17 }}>{item.value}</div>{item.detail ? <div style={{ color: MUTED, fontFamily: "Arial, Helvetica, sans-serif", fontSize: 22, lineHeight: 1.22, marginTop: 15 }}>{item.detail}</div> : null}<div style={{ height: 3, background: index === items.length - 1 ? RED : BLUE, marginTop: "auto" }} /></Surface>;
    })}
  </div>
);

const TimelineStage: React.FC<{ spec: PrimaryEvidenceSpec; reveal: number }> = ({ spec, reveal }) => <div style={{ position: "absolute", left: 82, right: 82, top: 226, bottom: spec.limitation ? 264 : 204 }}><Cards items={spec.items || []} reveal={reveal} /></div>;

// The left headline card and the right supporting-card grid are both driven
// entirely by spec.items (this shot's own authored evidence content) -- the
// left card is simply that array's own first entry rendered larger, not a
// second, separately-authored field. This used to hardcode one claim's real
// figure ("16 leading models stress-tested") as a permanent fixture of the
// source_article layout, which silently relabelled every OTHER claim's
// source_article shot with that same unrelated number; see the evidence-spec
// generator (scripts/lib/orvyq-evidence-authoring.mjs) for where spec.items
// is actually authored per shot.
const ArticleStage: React.FC<{ spec: PrimaryEvidenceSpec; reveal: number }> = ({ spec, reveal }) => {
  const items = spec.items || [];
  const [headline, ...rest] = items;
  return (
    <div style={{ position: "absolute", left: 88, right: 88, top: 210, bottom: spec.limitation ? 270 : 206, display: "grid", gridTemplateColumns: ".85fr 1.55fr", gap: 23 }}>
      <Surface style={{ padding: "34px 31px", display: "flex", alignItems: "center" }}>
        <div>
          <div style={{ color: RED, fontSize: 18, letterSpacing: ".14em", fontWeight: 900 }}>OFFICIAL RESEARCH ARTICLE</div>
          {headline ? (
            <>
              <div style={{ color: BLUE, fontFamily: "Arial, Helvetica, sans-serif", fontSize: 20, letterSpacing: ".1em", fontWeight: 800, marginTop: 25 }}>{headline.label}</div>
              <div style={{ color: INK, fontFamily: "Arial, Helvetica, sans-serif", fontSize: 34, lineHeight: 1.1, fontWeight: 830, marginTop: 10 }}>{headline.value}</div>
              {headline.detail ? <div style={{ color: MUTED, fontFamily: "Arial, Helvetica, sans-serif", fontSize: 22, lineHeight: 1.27, marginTop: 20 }}>{headline.detail}</div> : null}
            </>
          ) : null}
        </div>
      </Surface>
      <div><Cards items={rest} reveal={reveal} /></div>
    </div>
  );
};

const FlowStage: React.FC<{ spec: PrimaryEvidenceSpec; reveal: number }> = ({ spec, reveal }) => (
  <div style={{ position: "absolute", left: 98, right: 98, top: 245, bottom: spec.limitation ? 278 : 216, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
    {(spec.steps || []).map((step, index) => {
      const local = interpolate(reveal, [index / Math.max(1, (spec.steps || []).length), Math.min(1, (index + 1.2) / Math.max(1, (spec.steps || []).length))], [0, 1], clamp);
      return <React.Fragment key={step}><Surface style={{ width: 315, minHeight: 182, opacity: local, transform: `scale(${.94 + local * .06})`, padding: "27px 24px", display: "flex", alignItems: "center" }}><div><div style={{ color: index === (spec.steps || []).length - 1 ? RED : BLUE, fontSize: 18, fontWeight: 900, letterSpacing: ".12em" }}>{String(index + 1).padStart(2, "0")}</div><div style={{ color: INK, fontFamily: "Arial, Helvetica, sans-serif", fontSize: 29, lineHeight: 1.12, fontWeight: 780, marginTop: 14 }}>{step}</div></div></Surface>{index < (spec.steps || []).length - 1 ? <div style={{ color: BLUE, fontSize: 36, opacity: local }}>→</div> : null}</React.Fragment>;
    })}
  </div>
);

const ComparisonStage: React.FC<{ spec: PrimaryEvidenceSpec; reveal: number }> = ({ spec, reveal }) => (
  <div style={{ position: "absolute", left: 88, right: 88, top: 238, bottom: spec.limitation ? 276 : 212, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22 }}>
    {[{ title: spec.left || "", detail: spec.left_detail || "", color: BLUE, label: "SUPPORTS" }, { title: spec.right || "", detail: spec.right_detail || "", color: RED, label: "DOES NOT ESTABLISH" }].map((item, index) => <Surface key={item.title} style={{ padding: "34px 33px", opacity: interpolate(reveal, [index * .16, .56 + index * .16], [0, 1], clamp), transform: `translateX(${(index ? 1 : -1) * (1 - reveal) * 18}px)`, display: "flex", alignItems: "center" }}><div><div style={{ color: item.color, fontFamily: "Arial, Helvetica, sans-serif", fontSize: 18, letterSpacing: ".13em", fontWeight: 900 }}>{item.label}</div><div style={{ color: INK, fontFamily: "Arial, Helvetica, sans-serif", fontSize: 34, lineHeight: 1.08, fontWeight: 830, marginTop: 18 }}>{item.title}</div><div style={{ color: MUTED, fontFamily: "Arial, Helvetica, sans-serif", fontSize: 24, lineHeight: 1.27, fontWeight: 560, marginTop: 18 }}>{item.detail}</div></div></Surface>)}
  </div>
);

const RecapStage: React.FC<{ spec: PrimaryEvidenceSpec; progress: number }> = ({ spec, progress }) => (
  <div style={{ position: "absolute", left: 82, right: 82, top: 205, bottom: 198, display: "grid", gridTemplateColumns: "1fr 1fr 1.35fr", gap: 17 }}>
    {(spec.image_assets || []).slice(0, 3).map((asset, index) => <EvidenceImage key={asset} src={asset} progress={progress} focus={{ scale: 1.035 + index * .012, x: 0, y: 0 }} contain style={{ borderRadius: 9, transform: `translateY(${index === 1 ? 12 : 0}px)` }} />)}
  </div>
);

export const PrimaryEvidenceV2: React.FC<{ spec: PrimaryEvidenceSpec; durationInFrames: number }> = ({ spec, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const reveal = spring({ frame, fps, config: { damping: 24, stiffness: 96, mass: .9 }, durationInFrames: Math.min(38, durationInFrames) });
  const progress = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [0, 1], clamp);
  let body: React.ReactNode;
  if (spec.kind === "split_documents") body = <SplitDocuments spec={spec} progress={progress} />;
  else if (spec.kind === "official_document") body = <DocumentStage spec={spec} progress={progress} />;
  else if (spec.kind === "official_figure") body = <FigureStage spec={spec} progress={progress} />;
  else if (spec.kind === "official_screen") body = <ScreenStage spec={spec} progress={progress} />;
  else if (spec.kind === "image_sequence") body = <ImageSequence spec={spec} progress={progress} />;
  else if (spec.kind === "source_timeline") body = <TimelineStage spec={spec} reveal={reveal} />;
  else if (spec.kind === "source_article") body = <ArticleStage spec={spec} reveal={reveal} />;
  else if (["boundary", "comparison"].includes(spec.kind)) body = <ComparisonStage spec={spec} reveal={reveal} />;
  else if (spec.kind === "recap") body = <RecapStage spec={spec} progress={progress} />;
  else body = <FlowStage spec={spec} reveal={reveal} />;

  return (
    <AbsoluteFill style={{ opacity: reveal, background: `radial-gradient(circle at ${24 + progress * 10}% 18%,rgba(136,173,209,.15),transparent 35%),linear-gradient(145deg,#0B1521 0%,${GROUND} 58%,#050A11 100%)`, overflow: "hidden" }}>
      <AbsoluteFill style={{ opacity: .18, backgroundImage: "linear-gradient(rgba(136,173,209,.10) 1px,transparent 1px),linear-gradient(90deg,rgba(136,173,209,.10) 1px,transparent 1px)", backgroundSize: "72px 72px", transform: `translate(${progress * -10}px,${progress * -6}px)` }} />
      <Header spec={spec} />
      {body}
      <Limitation text={spec.limitation} />
      <SourceFooter spec={spec} />
    </AbsoluteFill>
  );
};
