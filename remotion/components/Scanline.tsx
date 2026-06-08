import React from "react";
import { theme } from "../theme";

/** A horizontal "scanning" beam that sweeps down a frame during capture. */
export const Scanline: React.FC<{
  progress: number; // 0..1 vertical position
  width: number;
  height: number;
  opacity?: number;
}> = ({ progress, width, height, opacity = 1 }) => {
  const y = progress * height;
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: y,
          width,
          height: 3,
          background: theme.accent,
          boxShadow: `0 0 18px 4px ${theme.accent}`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width,
          height: y,
          background: `linear-gradient(180deg, ${theme.accent}14 0%, ${theme.accent}04 100%)`,
        }}
      />
    </div>
  );
};
