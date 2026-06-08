import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { theme } from "./theme";
import type { RunData } from "./data";
import { SCENE, summaryFrom } from "./timeline";
import { TitleCard } from "./components/TitleCard";
import { SetupCard } from "./components/SetupCard";
import { BreakpointSection } from "./components/BreakpointSection";
import { SummaryCard } from "./components/SummaryCard";

export const VisualRegression: React.FC<{ run: RunData }> = ({ run }) => {
  return (
    <AbsoluteFill style={{ background: theme.bg }}>
      <Sequence from={SCENE.title.from} durationInFrames={SCENE.title.durationInFrames}>
        <TitleCard run={run} />
      </Sequence>

      <Sequence from={SCENE.setup.from} durationInFrames={SCENE.setup.durationInFrames}>
        <SetupCard run={run} />
      </Sequence>

      {run.breakpoints.map((bp, i) => (
        <Sequence
          key={bp.id}
          from={SCENE.sectionsStart + i * SCENE.sectionFrames}
          durationInFrames={SCENE.sectionFrames}
        >
          <BreakpointSection bp={bp} dir={run.dir} shortLabel={run.shortLabel} />
        </Sequence>
      ))}

      <Sequence from={summaryFrom(run.breakpoints.length)} durationInFrames={SCENE.summaryDur}>
        <SummaryCard run={run} />
      </Sequence>
    </AbsoluteFill>
  );
};
