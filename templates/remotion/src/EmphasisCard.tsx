import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
} from "remotion";

export type EmphasisCardSpec = {
  eyebrow: string;
  title: string;
  accent?: string;
};

export const EmphasisCard: React.FC<{
  spec: EmphasisCardSpec;
  durationInFrames: number;
}> = ({ spec, durationInFrames }) => {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [0, 18], [0, 1], {
    easing: Easing.bezier(0.22, 1, 0.36, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const exit = interpolate(
    frame,
    [Math.max(0, durationInFrames - 16), durationInFrames],
    [1, 0],
    {
      easing: Easing.bezier(0.64, 0, 0.78, 0),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
  const opacity = enter * exit;
  const translateY = interpolate(enter, [0, 1], [30, 0]);
  const lineScale = interpolate(frame, [6, 28], [0, 1], {
    easing: Easing.bezier(0.22, 1, 0.36, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const accent = spec.accent || "#D95B53";

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        padding: "0 156px",
        pointerEvents: "none",
        background:
          "linear-gradient(90deg,rgba(3,7,12,.9) 0%,rgba(3,7,12,.62) 48%,rgba(3,7,12,.18) 100%)",
      }}
    >
      <div
        style={{
          opacity,
          transform: `translateY(${translateY}px)`,
          maxWidth: 1480,
          fontFamily: "Arial, Helvetica, sans-serif",
          textShadow: "0 6px 28px rgba(0,0,0,.72)",
        }}
      >
        <div
          style={{
            color: accent,
            fontSize: 25,
            fontWeight: 760,
            letterSpacing: "0.22em",
            marginBottom: 22,
          }}
        >
          {spec.eyebrow}
        </div>
        <div
          style={{
            color: "#F5F0E7",
            fontSize: spec.title.length > 25 ? 82 : 94,
            fontWeight: 820,
            letterSpacing: "-0.025em",
            lineHeight: 1.02,
            maxWidth: 1420,
          }}
        >
          {spec.title}
        </div>
        <div
          style={{
            marginTop: 34,
            width: 210,
            height: 5,
            borderRadius: 3,
            backgroundColor: accent,
            transform: `scaleX(${lineScale})`,
            transformOrigin: "left center",
            boxShadow: `0 0 24px ${accent}66`,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
