import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";
import type { RunData } from "../data";

export const SummaryCard: React.FC<{ run: RunData }> = ({ run }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const breakpoints = run.breakpoints;
  const failed = run.summary.different;
  const total = run.summary.comparisons;
  const fadeIn = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: "clamp" });

  const stat = (delay: number) =>
    spring({ frame: frame - delay, fps, config: { damping: 16, stiffness: 110 } });

  const countTo = (target: number, delay: number) =>
    Math.round(target * interpolate(frame, [delay, delay + 26], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }));

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(1200px 600px at 50% 45%, ${theme.bgPanel} 0%, ${theme.bg} 70%)`,
        justifyContent: "center",
        alignItems: "center",
        opacity: fadeIn,
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontFamily: theme.mono,
            fontSize: 20,
            letterSpacing: 5,
            color: theme.red,
            textTransform: "uppercase",
            opacity: stat(0),
          }}
        >
          Verdict · No visual parity
        </div>
        <div
          style={{
            fontFamily: theme.sans,
            fontWeight: 800,
            fontSize: 92,
            color: theme.text,
            marginTop: 14,
            opacity: stat(4),
          }}
        >
          {failed} / {total} breakpoints failed
        </div>

        <div style={{ display: "flex", gap: 26, justifyContent: "center", marginTop: 50 }}>
          <Stat label="Comparisons" value={`${countTo(run.summary.comparisons, 24)}`} appear={stat(24)} color={theme.text} />
          <Stat label="Different" value={`${countTo(run.summary.different, 32)}`} appear={stat(32)} color={theme.red} />
          <Stat label="Changes flagged" value={`${countTo(run.summary.changesFlagged, 40)}`} appear={stat(40)} color={theme.amber} />
          <Stat label="Errors" value={`${countTo(run.summary.errors, 48)}`} appear={stat(48)} color={theme.green} />
        </div>

        <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 46, opacity: stat(58) }}>
          {breakpoints.map((b) => (
            <span
              key={b.id}
              style={{
                fontFamily: theme.mono,
                fontSize: 20,
                color: theme.textDim,
                background: theme.bgPanelHi,
                border: `1px solid ${theme.border}`,
                borderLeft: `3px solid ${theme.red}`,
                borderRadius: 8,
                padding: "10px 18px",
              }}
            >
              {b.label} · {(b.diffRatio * 100).toFixed(1)}% diff
            </span>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Stat: React.FC<{ label: string; value: string; appear: number; color: string }> = ({
  label,
  value,
  appear,
  color,
}) => (
  <div
    style={{
      opacity: appear,
      transform: `translateY(${(1 - appear) * 18}px)`,
      background: theme.bgPanel,
      border: `1px solid ${theme.border}`,
      borderRadius: 14,
      padding: "26px 38px",
      minWidth: 210,
    }}
  >
    <div style={{ fontFamily: theme.mono, fontWeight: 800, fontSize: 64, color }}>{value}</div>
    <div style={{ fontFamily: theme.mono, fontSize: 16, letterSpacing: 1, color: theme.textDim, marginTop: 4 }}>
      {label}
    </div>
  </div>
);
