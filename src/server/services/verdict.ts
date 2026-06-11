import { config } from "../config.js";
import type {
  CompareRequest,
  CompareResponse,
  PixelResult,
} from "../types.js";
import { comparePixels } from "./pixelDiff.js";
import { triageWithVision } from "./visionTriage.js";

/**
 * Runs the hybrid comparison:
 *  - diffRatio <= pixelThreshold -> instant PASS (no model call)
 *  - diffRatio >= maxRatio       -> instant FAIL (no model call)
 *  - otherwise                   -> AI vision triage decides
 */
export async function compare(
  request: CompareRequest,
): Promise<CompareResponse> {
  const pixelThreshold =
    request.pixelThreshold ?? config.diff.pixelThreshold;
  const maxRatio = request.maxRatio ?? config.diff.maxRatio;

  const { pixel, diffPngBase64 } = await comparePixels(
    request.baselinePng,
    request.currentPng,
    {
      pixelMatchThreshold: config.diff.pixelMatchThreshold,
      ignoreRegions: request.ignoreRegions,
    },
  );

  const base = {
    pixel,
    diffPng: diffPngBase64,
    name: request.name,
  } satisfies Partial<CompareResponse> & { pixel: PixelResult };

  if (pixel.diffRatio <= pixelThreshold) {
    return {
      ...base,
      verdict: "pass",
      decidedBy: "pixel-pass",
      needsReview: false,
      ai: null,
    };
  }

  if (pixel.diffRatio >= maxRatio) {
    return {
      ...base,
      verdict: "fail",
      decidedBy: "pixel-fail",
      needsReview: false,
      ai: null,
    };
  }

  try {
    const ai = await triageWithVision({
      baselinePng: request.baselinePng,
      currentPng: request.currentPng,
      diffPng: diffPngBase64,
      pixel,
      context: request.context,
    });

    return {
      ...base,
      verdict: ai.regression ? "fail" : "pass",
      decidedBy: "ai",
      // Borderline AI calls get a human in the loop instead of blind trust.
      needsReview: ai.confidence < config.llm.reviewConfidence,
      ai,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Fail closed: an AI error becomes a "needs human review" failure rather
    // than a silent pass, so regressions are never hidden by infra problems.
    return {
      ...base,
      verdict: "fail",
      decidedBy: "ai-error",
      needsReview: true,
      ai: {
        regression: true,
        confidence: 0,
        summary: `Vision triage failed; flagged for human review. ${message}`,
        changes: [],
        error: message,
      },
    };
  }
}
