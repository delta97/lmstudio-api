import React from "react";
import { spring, useVideoConfig } from "remotion";
import { theme, severityColor } from "../theme";
import type { Change } from "../data";

/** Flagged changes stagger in as severity-tagged rows. */
export const ChangePills: React.FC<{
  changes: Change[];
  frame: number; // local frame within the changes phase
  startFrame: number;
  staggerFrames: number;
}> = ({ changes, frame, startFrame, staggerFrames }) => {
  const { fps } = useVideoConfig();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div
        style={{
          fontFamily: theme.mono,
          fontSize: 16,
          letterSpacing: 1,
          color: theme.textDim,
          marginBottom: 2,
        }}
      >
        FLAGGED CHANGES · {changes.length}
      </div>
      {changes.map((c, i) => {
        const appear = spring({
          frame: frame - startFrame - i * staggerFrames,
          fps,
          config: { damping: 16, stiffness: 120, mass: 0.6 },
        });
        const col = severityColor(c.severity);
        return (
          <div
            key={i}
            style={{
              opacity: appear,
              transform: `translateX(${(1 - appear) * 24}px)`,
              display: "flex",
              gap: 12,
              alignItems: "flex-start",
              background: theme.bgPanelHi,
              border: `1px solid ${theme.border}`,
              borderLeft: `3px solid ${col}`,
              borderRadius: 8,
              padding: "10px 14px",
            }}
          >
            <span
              style={{
                fontFamily: theme.mono,
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: 1,
                color: col,
                textTransform: "uppercase",
                paddingTop: 3,
                minWidth: 64,
              }}
            >
              {c.severity}
            </span>
            <span style={{ fontFamily: theme.sans, fontSize: 17, lineHeight: 1.4, color: theme.text }}>
              <strong style={{ color: theme.text }}>{c.area}</strong>
              <span style={{ color: theme.textDim }}> — {c.detail}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
};
