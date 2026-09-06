import { defineTool } from "eve/tools";
import { z } from "zod";

import {
  type InspectionReportFailure,
  InspectionReportRetryableError,
  parseInspectionReport,
} from "../lib/inspection-report";

export default defineTool({
  description:
    "Parse one staged inspection-report PDF through the local PaddleOCR-VL service and save the reconstructed document in the workspace. Call this before reading or answering from a staged PDF attachment.",
  inputSchema: z.object({
    path: z
      .string()
      .min(1)
      .describe("Workspace path of the staged PDF, e.g. /workspace/attachments/<hash>/<report>.pdf"),
  }),
  async *execute({ path }, ctx) {
    const sandbox = await ctx.getSandbox();
    try {
      yield* parseInspectionReport({
        sandbox,
        stagedPath: path,
        paddleOptions: { signal: ctx.abortSignal },
      });
    } catch (error) {
      if (ctx.abortSignal.aborted) throw error;
      yield {
        status: "failed",
        retryable: error instanceof InspectionReportRetryableError,
        error: error instanceof Error ? error.message : String(error),
      } satisfies InspectionReportFailure;
    }
  },
});
