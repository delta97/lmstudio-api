import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { theme } from "../theme";
import { SECTION } from "../timeline";
import type { Breakpoint } from "../data";
import { DeviceFrame } from "./DeviceFrame";
import { Scanline } from "./Scanline";
import { DiffMeter } from "./DiffMeter";
import { AICallout } from "./AICallout";
import { ChangePills } from "./ChangePills";

// Per-breakpoint on-screen viewport sizing (kept natural to the device width).
const VIEW: Record<Breakpoint["id"], { w: number; h: number }> = {
  mobile: { w: 300, h: 760 },
  tablet: { w: 392, h: 760 },
  desktop: { w: 496, h: 760 },
};

export const BreakpointSection: React.FC<{ bp: Breakpoint; dir: string; shortLabel: string }> = ({
  bp,
  dir,
  shortLabel,
}) => {
  const sf = useCurrentFrame(); // section-local frame (Sequence resets it)
  const view = VIEW[bp.id];

  const scroll = interpolate(sf, [0, SECTION.scrollDur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const scanProgress = interpolate(sf, [0, SECTION.scanlineDur], [0, 1], {
    extrapolateRight: "clamp",
  });
  const scanOpacity = interpolate(sf, [0, 10, SECTION.scanlineDur - 20, SECTION.scanlineDur], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const diffProgress = interpolate(sf, [SECTION.diffFrom, SECTION.diffFrom + SECTION.diffDur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const aiFrame = sf - SECTION.aiFrom;

  return (
    <AbsoluteFill style={{ background: theme.bg, padding: "48px 60px" }}>
      {/* header strip */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
        <span style={{ fontFamily: theme.sans, fontWeight: 800, fontSize: 40, color: theme.text }}>
          {bp.label}
        </span>
        <span style={{ fontFamily: theme.mono, fontSize: 22, color: theme.textDim }}>
          {bp.width}×{bp.height}
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontFamily: theme.mono, fontSize: 18, color: theme.textFaint, letterSpacing: 1 }}>
          {shortLabel}
        </span>
      </div>

      <div style={{ display: "flex", gap: 48, marginTop: 28, flex: 1 }}>
        {/* left: two device frames */}
        <div style={{ display: "flex", gap: 28, alignItems: "flex-start" }}>
          <div style={{ position: "relative" }}>
            <DeviceFrame
              label="Baseline"
              src={`${dir}/${bp.id}-baseline.png`}
              nativeW={bp.shot.w}
              nativeH={bp.shot.baselineH}
              viewportW={view.w}
              viewportH={view.h}
              scroll={scroll}
              accent={theme.border}
            />
            <Scanline progress={scanProgress} width={view.w} height={view.h + 0} opacity={scanOpacity} />
          </div>
          <div style={{ position: "relative" }}>
            <DeviceFrame
              label={diffProgress > 0.05 ? "Current · diff" : "Current"}
              src={`${dir}/${bp.id}-current.png`}
              nativeW={bp.shot.w}
              nativeH={bp.shot.currentH}
              viewportW={view.w}
              viewportH={view.h}
              scroll={scroll}
              diffSrc={`${dir}/${bp.id}-diff.png`}
              diffNativeH={bp.shot.diffH}
              diffOpacity={diffProgress}
              accent={diffProgress > 0.05 ? theme.redDeep : theme.border}
            />
            <Scanline progress={scanProgress} width={view.w} height={view.h} opacity={scanOpacity} />
          </div>
        </div>

        {/* right: analysis panel */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: 22,
            paddingTop: 30,
            minWidth: 0,
          }}
        >
          <DiffMeter ratio={bp.diffRatio} progress={diffProgress} />

          {sf >= SECTION.aiFrom ? (
            <AICallout
              summary={bp.aiSummary}
              frame={aiFrame}
              spinnerFrames={SECTION.aiSpinner}
              typeFrames={SECTION.aiType}
              stampFrame={SECTION.aiStamp}
            />
          ) : (
            <div
              style={{
                fontFamily: theme.mono,
                fontSize: 18,
                color: theme.textFaint,
                letterSpacing: 1,
              }}
            >
              {sf < SECTION.diffFrom ? "CAPTURING…" : "DIFFING PIXELS…"}
            </div>
          )}

          {sf >= SECTION.changesFrom ? (
            <ChangePills
              changes={bp.changes}
              frame={sf}
              startFrame={SECTION.changesFrom}
              staggerFrames={SECTION.changesStagger}
            />
          ) : null}
        </div>
      </div>
    </AbsoluteFill>
  );
};
