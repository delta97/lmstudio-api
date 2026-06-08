import React from "react";
import { interpolate } from "remotion";
import { theme } from "../theme";

/** Animated pixel-diff ratio: ticking counter + severity bar (amber→red). */
export const DiffMeter: React.FC<{
  ratio: number; // final 0..1
  progress: number; // 0..1 animation progress
}> = ({ ratio, progress }) => {
  const shown = ratio * progress;
  const pct = (shown * 100).toFixed(2);
  // Bar fill caps visual at 60% width for readability; color ramps amber→red.
  const fill = interpolate(shown, [0, 0.6], [0, 100], { extrapolateRight: "clamp" });
  const color = interpolate(progress, [0, 1], [0, 1]) > 0.5 ? theme.red : theme.amber;

  return (
    <div style={{ width: "100%" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          fontFamily: theme.mono,
        }}
      >
        <span style={{ color: theme.textDim, fontSize: 18, letterSpacing: 1 }}>
          PIXEL DIFF
        </span>
        <span style={{ color, fontSize: 44, fontWeight: 700 }}>{pct}%</span>
      </div>
      <div
        style={{
          marginTop: 10,
          height: 12,
          borderRadius: 6,
          background: theme.bgPanelHi,
          border: `1px solid ${theme.border}`,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${fill}%`,
            height: "100%",
            background: `linear-gradient(90deg, ${theme.amber}, ${theme.red})`,
            boxShadow: `0 0 14px ${theme.red}88`,
          }}
        />
      </div>
    </div>
  );
};
