import React from "react";
import { staticFile } from "remotion";
import { theme } from "../theme";

/**
 * A fixed-size viewport that holds a tall full-page screenshot and scrolls it
 * vertically by `scroll` (0..1). Optionally cross-fades a second (diff) image
 * over the primary one via `diffOpacity` (0..1).
 */
export const DeviceFrame: React.FC<{
  label: string;
  src: string;
  nativeW: number;
  nativeH: number;
  viewportW: number;
  viewportH: number;
  scroll: number; // 0..1
  diffSrc?: string;
  diffNativeH?: number;
  diffOpacity?: number; // 0..1
  accent?: string;
}> = ({
  label,
  src,
  nativeW,
  nativeH,
  viewportW,
  viewportH,
  scroll,
  diffSrc,
  diffNativeH,
  diffOpacity = 0,
  accent = theme.border,
}) => {
  const displayH = (viewportW / nativeW) * nativeH;
  const maxScroll = Math.max(0, displayH - viewportH);
  const y = -scroll * maxScroll;

  const diffDisplayH = diffNativeH ? (viewportW / nativeW) * diffNativeH : displayH;
  const diffMax = Math.max(0, diffDisplayH - viewportH);
  const diffY = -scroll * diffMax;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
      <div
        style={{
          fontFamily: theme.mono,
          fontSize: 18,
          letterSpacing: 2,
          textTransform: "uppercase",
          color: theme.textDim,
        }}
      >
        {label}
      </div>
      <div
        style={{
          width: viewportW,
          height: viewportH,
          overflow: "hidden",
          position: "relative",
          borderRadius: 14,
          border: `2px solid ${accent}`,
          boxShadow: `0 24px 60px rgba(0,0,0,0.5), 0 0 0 6px ${theme.bgPanel}`,
          background: "#fff",
        }}
      >
        <img
          src={staticFile(src)}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: viewportW,
            transform: `translateY(${y}px)`,
          }}
        />
        {diffSrc ? (
          <img
            src={staticFile(diffSrc)}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: viewportW,
              transform: `translateY(${diffY}px)`,
              opacity: diffOpacity,
            }}
          />
        ) : null}
        {/* top/bottom vignette so the scroll reads as a window */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background:
              "linear-gradient(180deg, rgba(11,14,20,0.35) 0%, rgba(11,14,20,0) 12%, rgba(11,14,20,0) 88%, rgba(11,14,20,0.35) 100%)",
          }}
        />
      </div>
    </div>
  );
};
