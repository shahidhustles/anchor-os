import { defineTool } from "eve/tools";
import { z } from "zod";

import { parseInspectionReport } from "../lib/inspection-report";

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
    yield* parseInspectionReport({
      sandbox,
      stagedPath: path,
      paddleOptions: { signal: ctx.abortSignal },
    });
  },
});
