import { writeFile } from "node:fs/promises";
import { createLocalRouter, type RuntimeEvent } from "./runtime";
import { DEFAULT_MODEL_CANDIDATES, MVP_MODEL_PROFILES } from "./profiles";

const cases = [
  {
    family: "documents",
    task: "Create a professional Word document named Equipment_Inspection_Report.docx with an inspection summary, findings table, recommendations and conclusion. Use the DOCX skill and verify the file.",
    tools: true,
    tokens: 2000,
  },
  {
    family: "coding",
    task: "Debug this Python API and run the regression tests in a sandbox.",
    tools: true,
    tokens: 4000,
  },
  {
    family: "reasoning",
    task: "Calculate the pressure drop in a pipe step by step and derive the equation.",
    tools: false,
    tokens: 1000,
  },
  {
    family: "simple",
    task: "Rewrite this sentence politely: Send the note today.",
    tools: false,
    tokens: 100,
  },
  {
    family: "tools",
    task: "Search the workspace, read three inspection files, extract findings and save a JSON summary.",
    tools: true,
    tokens: 4000,
  },
  {
    family: "long_context",
    task: "Compare all sections of this long operating manual and cite every discrepancy.",
    tools: false,
    tokens: 150000,
  },
];
const events: RuntimeEvent[] = [];
const route = createLocalRouter({ onEvent: (e) => events.push(e) });
const results = [];
for (const item of cases) {
  const started = performance.now();
  const result = await route({
    user_task: item.task,
    candidate_models: [...DEFAULT_MODEL_CANDIDATES],
    profiles: [...MVP_MODEL_PROFILES],
    requires_tools: item.tools,
    input_tokens: item.tokens,
  });
  const row = { family: item.family, ...result, seconds: (performance.now() - started) / 1000 };
  results.push(row);
  process.stdout.write(`${JSON.stringify(row)}\n`);
}
await writeFile(
  new URL("./artifacts/local-demo.json", import.meta.url),
  JSON.stringify({ results, events, note: "Six smoke examples, not held-out accuracy" }, null, 2),
);
if (events.some((e) => e.kind === "router_fallback"))
  throw new Error("Demo used fallback; inspect the local service");
