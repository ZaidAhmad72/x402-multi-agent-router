import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { config } from "./config.js";
import { x402Middleware, extractTransactionId } from "./payments/x402setup.js";
import { runOrchestration } from "./orchestrator.js";
import { runDemoPayment } from "./demo.js";
import { getAllBalances } from "./balances.js";

const app = new Hono();

// CORS — must be first; x402 requires wildcard CORS to expose Payment-Signature headers.
app.use("*", async (c, next) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PUT, DELETE, HEAD",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Expose-Headers": "*",
    "Access-Control-Max-Age": "86400",
  };

  if (c.req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  Object.entries(corsHeaders).forEach(([key, value]) => {
    c.header(key, value);
  });

  await next();
});

app.use("*", async (c, next) => {
  const timestamp = new Date().toISOString();
  console.log(`\n[${timestamp}] ${c.req.method} ${c.req.path}`);
  await next();
  console.log(`  Response: ${c.res.status}`);
});

app.get("/health", (c) => c.json({ status: "ok" }));

app.get("/balances", async (c) => c.json({ balances: await getAllBalances() }));

app.use("/router/task", x402Middleware);

app.get("/router/task", async (c) => {
  const txId = extractTransactionId(c);
  const task = c.req.query("task") ?? "";

  // Payment is already verified by this point, so we can't refuse for an
  // empty task — but we can avoid wasting a Groq call and give an honest
  // response instead of running agents against nothing.
  if (!task.trim()) {
    return c.json({
      message: "paid access granted",
      txId,
      task,
      agents: [],
      result: {},
      note: "No task text provided — pass ?task=<your question> to get real agent results.",
    });
  }

  const result = await runOrchestration(task);

  return c.json({ message: "paid access granted", txId, task, agents: result.agents, result });
});

// DEBUG ONLY — no payment gate. Runs the same agent logic as /router/task so
// the dashboard can show real answers while testnet USDC is unavailable.
// Not part of the real product surface; remove before any real demo/judging.
app.get("/debug/preview", async (c) => {
  const task = c.req.query("task") ?? "";
  if (!task) {
    return c.json({ error: "task is required" }, 400);
  }

  const result = await runOrchestration(task);

  return c.json({ debug: true, task, agents: result.agents, result });
});

// Demo-only: drives the real 402-pay-verify-200 flow server-side, using a
// wallet that never leaves the server, so the dashboard never holds a key.
app.post("/demo/run", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const task = typeof body?.task === "string" ? body.task.trim() : "";
  if (!task) {
    return c.json({ error: "task is required" }, 400);
  }

  try {
    const result = await runDemoPayment(task);
    return c.json(result);
  } catch (error) {
    console.error("Demo run failed:", error);
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

app.use("/*", serveStatic({ root: "./public" }));

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Server listening on http://localhost:${info.port}`);
});
