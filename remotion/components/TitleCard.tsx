import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";
import type { RunData } from "../data";

export const TitleCard: React.FC<{ run: RunData }> = ({ run }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const rise = spring({ frame, fps, config: { damping: 18, stiffness: 90 } });
  const subRise = spring({ frame: frame - 12, fps, config: { damping: 18, stiffness: 90 } });
  const fadeOut = interpolate(frame, [95, 120], [1, 0], { extrapolateLeft: "clamp" });

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(1200px 600px at 50% 40%, ${theme.bgPanel} 0%, ${theme.bg} 70%)`,
        justifyContent: "center",
        alignItems: "center",
        opacity: fadeOut,
      }}
    >
      <PixelGrid frame={frame} />
      <div style={{ position: "relative", textAlign: "center" }}>
        <div
          style={{
            fontFamily: theme.mono,
            fontSize: 20,
            letterSpacing: 6,
            color: theme.accent,
            textTransform: "uppercase",
            opacity: rise,
            transform: `translateY(${(1 - rise) * 16}px)`,
            marginBottom: 18,
          }}
        >
          LM Studio · Visual Regression
        </div>
        <div
          style={{
            fontFamily: theme.sans,
            fontWeight: 800,
            fontSize: 78,
            color: theme.text,
            opacity: rise,
            transform: `translateY(${(1 - rise) * 24}px)`,
            lineHeight: 1.05,
          }}
        >
          {run.titleLine}
        </div>
        <div
          style={{
            marginTop: 26,
            fontFamily: theme.mono,
            fontSize: 30,
            color: theme.textDim,
            opacity: subRise,
            transform: `translateY(${(1 - subRise) * 20}px)`,
          }}
        >
          <span style={{ color: theme.text }}>{run.baselineUrl}</span>
          <span style={{ color: theme.accent, margin: "0 16px" }}>→</span>
          <span style={{ color: theme.text }}>{run.currentUrl}</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const PixelGrid: React.FC<{ frame: number }> = ({ frame }) => {
  const reveal = interpolate(frame, [0, 40], [0, 1], { extrapolateRight: "clamp" });
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        opacity: 0.12 * reveal,
        backgroundImage: `linear-gradient(${theme.borderHi} 1px, transparent 1px), linear-gradient(90deg, ${theme.borderHi} 1px, transparent 1px)`,
        backgroundSize: "44px 44px",
        maskImage: "radial-gradient(700px 500px at 50% 45%, black, transparent 80%)",
        WebkitMaskImage: "radial-gradient(700px 500px at 50% 45%, black, transparent 80%)",
      }}
    />
  );
};
