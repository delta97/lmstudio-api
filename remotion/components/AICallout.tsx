import React from "react";
import { interpolate, spring, useVideoConfig } from "remotion";
import { theme } from "../theme";

/** "Triaging…" spinner → typewriter AI summary → FAIL stamp. */
export const AICallout: React.FC<{
  summary: string;
  frame: number; // local frame within the AI phase
  spinnerFrames: number; // how long the spinner shows before typing
  typeFrames: number; // frames over which the text types
  stampFrame: number; // local frame the FAIL stamp slams in
}> = ({ summary, frame, spinnerFrames, typeFrames, stampFrame }) => {
  const { fps } = useVideoConfig();
  const triaging = frame < spinnerFrames;
  const typeP = interpolate(frame, [spinnerFrames, spinnerFrames + typeFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const chars = Math.floor(typeP * summary.length);
  const shown = summary.slice(0, chars);
  const caretOn = Math.floor(frame / 8) % 2 === 0 && typeP < 1;

  const stampS = spring({
    frame: frame - stampFrame,
    fps,
    config: { damping: 9, stiffness: 180, mass: 0.7 },
  });
  const stampScale = interpolate(stampS, [0, 1], [1.6, 1]);
  const stampVisible = frame >= stampFrame;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          fontFamily: theme.mono,
          fontSize: 18,
          color: theme.accent,
          letterSpacing: 1,
        }}
      >
        <Spinner show={triaging} frame={frame} />
        {triaging ? "TRIAGING WITH VISION MODEL…" : "VISION MODEL VERDICT"}
      </div>

      {!triaging ? (
        <div
          style={{
            marginTop: 16,
            fontFamily: theme.sans,
            fontSize: 23,
            lineHeight: 1.5,
            color: theme.text,
            minHeight: 170,
          }}
        >
          {shown}
          <span style={{ opacity: caretOn ? 1 : 0, color: theme.accent }}>▋</span>
        </div>
      ) : (
        <div style={{ minHeight: 186 }} />
      )}

      {stampVisible ? (
        <div
          style={{
            marginTop: 8,
            display: "inline-flex",
            alignItems: "center",
            gap: 14,
            transform: `scale(${stampScale})`,
            transformOrigin: "left center",
          }}
        >
          <span
            style={{
              fontFamily: theme.mono,
              fontWeight: 800,
              fontSize: 38,
              letterSpacing: 4,
              color: theme.red,
              border: `3px solid ${theme.red}`,
              padding: "4px 18px",
              borderRadius: 8,
              boxShadow: `0 0 24px ${theme.red}55`,
            }}
          >
            FAIL
          </span>
          <span style={{ fontFamily: theme.mono, fontSize: 18, color: theme.textDim }}>
            regression · ai triage
          </span>
        </div>
      ) : null}
    </div>
  );
};

const Spinner: React.FC<{ show: boolean; frame: number }> = ({ show, frame }) =>
  show ? (
    <span
      style={{
        width: 14,
        height: 14,
        borderRadius: "50%",
        border: `2px solid ${theme.accentDim}`,
        borderTopColor: theme.accent,
        display: "inline-block",
        transform: `rotate(${frame * 24}deg)`,
      }}
    />
  ) : (
    <span
      style={{
        width: 12,
        height: 12,
        borderRadius: 3,
        background: theme.red,
        display: "inline-block",
      }}
    />
  );
