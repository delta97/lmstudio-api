import React from "react";
import { Composition } from "remotion";
import { VisualRegression } from "./VisualRegression";
import { FPS, totalFrames } from "./timeline";
import { runs } from "./data";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {runs.map((run) => (
        <Composition
          key={run.id}
          id={run.id}
          component={VisualRegression}
          durationInFrames={totalFrames(run.breakpoints.length)}
          fps={FPS}
          width={1920}
          height={1080}
          defaultProps={{ run }}
        />
      ))}
    </>
  );
};
