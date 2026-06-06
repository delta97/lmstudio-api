// Frame layout for the 30fps video. Durations scale with breakpoint count.
export const FPS = 30;

export const SCENE = {
  title: { from: 0, durationInFrames: 120 }, // 0–4s
  setup: { from: 120, durationInFrames: 90 }, // 4–7s
  sectionFrames: 450, // each breakpoint section, 15s
  sectionsStart: 210,
  summaryDur: 240, // 8s
};

export const summaryFrom = (n: number) => SCENE.sectionsStart + n * SCENE.sectionFrames;
export const totalFrames = (n: number) => summaryFrom(n) + SCENE.summaryDur;

// Local timeline within a single 450-frame breakpoint section.
export const SECTION = {
  scrollDur: 150, // capture scroll completes at sf=150, then holds
  scanlineDur: 150,
  diffFrom: 120, // current → diff cross-fade + meter (overlaps capture tail)
  diffDur: 95,
  aiFrom: 210, // AICallout receives frame = sf - aiFrom
  aiSpinner: 25,
  aiType: 95,
  aiStamp: 120, // local to aiFrom → sf 330
  changesFrom: 320,
  changesStagger: 14,
};
