import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";
import type { RunData } from "../data";

export const SetupCard: React.FC<{ run: RunData }> = ({ run }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fadeOut = interpolate(frame, [70, 90], [1, 0], { extrapolateLeft: "clamp" });

  const chip = (delay: number) =>
    spring({ frame: frame - delay, fps, config: { damping: 16, stiffness: 110 } });

  return (
    <AbsoluteFill
      style={{
        background: theme.bg,
        justifyContent: "center",
        alignItems: "center",
        opacity: fadeOut,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 34 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 30 }}>
          <Chip
            kind="Baseline"
            url={run.baselineUrl}
            color={theme.textDim}
            appear={chip(0)}
          />
          <div
            style={{
              fontFamily: theme.mono,
              fontSize: 40,
              color: theme.accent,
              opacity: chip(8),
            }}
          >
            vs
          </div>
          <Chip kind="Current" url={run.currentUrl} color={theme.accent} appear={chip(14)} />
        </div>

        <div
          style={{
            opacity: chip(26),
            transform: `translateY(${(1 - chip(26)) * 12}px)`,
            display: "flex",
            gap: 14,
            fontFamily: theme.mono,
            fontSize: 20,
            color: theme.textDim,
          }}
        >
          <Tag>3 breakpoints</Tag>
          <Tag>pixel-diff gate</Tag>
          <Tag>+ vision-model triage</Tag>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Chip: React.FC<{ kind: string; url: string; color: string; appear: number }> = ({
  kind,
  url,
  color,
  appear,
}) => (
  <div
    style={{
      opacity: appear,
      transform: `translateY(${(1 - appear) * 20}px) scale(${interpolate(appear, [0, 1], [0.9, 1])})`,
      background: theme.bgPanel,
      border: `1px solid ${theme.border}`,
      borderTop: `3px solid ${color}`,
      borderRadius: 12,
      padding: "22px 34px",
      minWidth: 360,
    }}
  >
    <div style={{ fontFamily: theme.mono, fontSize: 16, letterSpacing: 2, color, textTransform: "uppercase" }}>
      {kind}
    </div>
    <div style={{ fontFamily: theme.sans, fontWeight: 700, fontSize: 34, color: theme.text, marginTop: 6 }}>
      {url}
    </div>
  </div>
);

const Tag: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span
    style={{
      background: theme.bgPanelHi,
      border: `1px solid ${theme.border}`,
      borderRadius: 999,
      padding: "6px 16px",
    }}
  >
    {children}
  </span>
);
