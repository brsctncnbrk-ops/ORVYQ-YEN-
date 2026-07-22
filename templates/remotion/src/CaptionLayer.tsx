import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

type Caption = {
  caption_id: string;
  scene_id?: string | null;
  start_frame: number;
  end_frame: number;
  text: string;
};

export const CaptionLayer: React.FC<{ captions: Caption[] }> = ({ captions }) => {
  const frame = useCurrentFrame();
  const caption = captions.find((item) => frame >= item.start_frame && frame < item.end_frame);
  if (!caption) return null;

  const localFrame = frame - caption.start_frame;
  const duration = Math.max(1, caption.end_frame - caption.start_frame);
  const fadeFrames = Math.min(6, Math.max(3, Math.floor(duration / 6)));
  const opacity = Math.min(
    interpolate(localFrame, [0, fadeFrames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
    interpolate(localFrame, [duration - fadeFrames, duration], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
  );

  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 72, pointerEvents: "none" }}>
      <div
        style={{
          opacity,
          maxWidth: "88%",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "clip",
          textAlign: "center",
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 44,
          fontWeight: 650,
          lineHeight: 1.06,
          letterSpacing: "-0.015em",
          color: "#F8F5EE",
          background: "rgba(4,8,14,.46)",
          border: "1px solid rgba(248,245,238,.10)",
          borderRadius: 8,
          padding: "10px 18px 12px",
          boxShadow: "0 10px 32px rgba(0,0,0,.34)",
          textShadow: "0 2px 4px rgba(0,0,0,.98), 0 0 18px rgba(0,0,0,.82)",
        }}
      >
        {caption.text}
      </div>
    </AbsoluteFill>
  );
};
