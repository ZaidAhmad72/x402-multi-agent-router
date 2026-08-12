/**
 * Router — Atomic Multi-Agent Service Router
 *
 * POST /route runs QUOTE -> SETTLE -> REDEEM: fan out the payment challenges,
 * gate on budget/group-size, build and submit one atomic group, then redeem
 * each agent's work against on-chain proof.
 */

import { config } from 'dotenv';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { quoteAgents, LivenessError } from './quote';
import { settleGroup, BudgetExceededError, GroupTooLargeError } from './settle';
import { redeemAll, RedeemError } from './redeem';
import { getAllBalances } from './balances';
import { debugPreviewAll } from './debugPreview';
import { selectAgents } from './selectAgents';
import {
  runQualityGate,
  setQualityGateMode,
  getQualityGateMode,
  setForcedFailAgent,
  getForcedFailAgent,
  type QualityGateMode,
} from './qualityGate';
import { selfTestReplay } from './selfTestReplay';
import { AGENT_REGISTRY } from '../shared/constants';

config();
config({ path: '../.env.wallets' });

const port = parseInt(process.env.PORT || '4000', 10);

const app = new Hono();

// CORS — must be first; x402 requires wildcard CORS to expose Payment-Signature headers
app.use('*', async (c, next) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE, HEAD',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Expose-Headers': '*',
    'Access-Control-Max-Age': '86400',
  };

  if (c.req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  Object.entries(corsHeaders).forEach(([key, value]) => {
    c.header(key, value);
  });

  await next();
});

app.use('*', async (c, next) => {
  const timestamp = new Date().toISOString();
  console.log(`\n[${timestamp}] ${c.req.method.toUpperCase()} ${c.req.path}`);
  await next();
  console.log(`  Response: ${c.res.status}`);
});

app.post('/route', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const task = typeof body?.task === 'string' && body.task.trim() ? body.task.trim() : '';
  const maxSpend = typeof body?.maxSpend === 'number' ? body.maxSpend : undefined;
  const userAddr =
    typeof body?.userAddr === 'string' && body.userAddr.trim() ? body.userAddr.trim() : process.env.USER_ADDR;

  if (!task) {
    return c.json({ error: 'task is required' }, 400);
  }
  if (maxSpend === undefined) {
    return c.json({ error: 'maxSpend is required' }, 400);
  }

  const registry = await selectAgents(task);

  // QUALITY — trial-run every selected agent for free, before anyone is
  // asked for a price. A failing agent with a configured stake (stake.ts)
  // gets slashed instead of paid, decided later in SETTLE; a failing agent
  // with no stake has no financial accountability to fall back on, so it
  // aborts the whole route here, same as before stake+slash existed.
  const qualityVerdicts = await runQualityGate(task, registry);
  const unstakedFailures = qualityVerdicts.filter((v) => !v.ok && !v.staked);
  if (unstakedFailures.length > 0) {
    const message =
      `Quality gate rejected ${unstakedFailures.length} agent output(s) before any payment: ` +
      unstakedFailures.map((f) => `${f.agent} (${f.reason})`).join('; ');
    console.error(`✗ ${message}`);
    return c.json({ error: message, phase: 'QUALITY', zeroSpend: true, qualityVerdicts }, 502);
  }

  let quotePhase;
  try {
    quotePhase = await quoteAgents(registry);
  } catch (error) {
    if (error instanceof LivenessError) {
      console.error(`✗ ${error.message}`);
      return c.json({ error: error.message, phase: 'QUOTE', zeroSpend: true, qualityVerdicts }, 502);
    }
    console.error('Unexpected error in QUOTE phase:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }

  let settlement;
  try {
    settlement = await settleGroup(quotePhase, maxSpend, qualityVerdicts, userAddr);
  } catch (error) {
    if (error instanceof BudgetExceededError || error instanceof GroupTooLargeError) {
      console.error(`✗ ${error.message}`);
      return c.json({ error: error.message, phase: 'QUOTE', zeroSpend: true, qualityVerdicts }, 400);
    }
    console.error('Unexpected error in SETTLE phase:', error);
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('underflow on subtracting')) {
      return c.json(
        {
          error:
            'Settlement failed: the router wallet (ROUTER_ADDR) — or a stake wallet, if a slash is pending — ' +
            'does not have enough testnet USDC. Fund it and retry — nothing was spent.',
          phase: 'QUOTE',
          zeroSpend: true,
          qualityVerdicts,
        },
        502
      );
    }
    return c.json({ error: 'Internal server error' }, 500);
  }

  // Money has moved at this point. A redeem failure here is a known,
  // documented gap (CLAUDE.md §8) — atomic payment is not atomic execution.
  // Surface it honestly rather than pretending success.
  try {
    const result = await redeemAll(task, quotePhase.quotes, settlement);
    c.header('X-Group-Id', settlement.groupId);
    c.header('X-Explorer-Url', settlement.explorerUrl);

    // The "money shot" receipt — exactly who got paid, who got slashed, and
    // why, in one place, instead of having to reconstruct it from logs.
    const receipt = settlement.perAgent.map((p) => ({
      agent: p.agent,
      outcome: p.outcome,
      amountUsd: Number(p.amountMicroUsdc) / 1_000_000,
      ...(p.outcome === 'slashed' ? { rebateToUser: userAddr, reason: p.reason } : {}),
    }));

    return c.json({
      phase: 'REDEEMED',
      task,
      maxSpend,
      quotes: quotePhase.quotes,
      totalUsd: quotePhase.totalUsd,
      totalMicroUsdc: quotePhase.totalMicroUsdc,
      qualityVerdicts,
      settlement,
      receipt,
      result,
    });
  } catch (error) {
    const message = error instanceof RedeemError ? error.message : 'Internal server error during redeem';
    console.error(`✗ REDEEM incomplete: ${message}`);
    return c.json(
      {
        error: message,
        phase: 'SETTLED',
        settledButNotRedeemed: true,
        settlement,
        qualityVerdicts,
      },
      502
    );
  }
});

// DEBUG ONLY — no payment gate, no atomic group. Runs the real pipeline
// logic against each agent's unprotected /debug/preview route, so the
// pipeline can be exercised while wallets are unfunded. Not part of the
// real product surface; remove before any real demo/judging.
app.post('/debug/preview', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const task = typeof body?.task === 'string' && body.task.trim() ? body.task.trim() : '';
  if (!task) {
    return c.json({ error: 'task is required' }, 400);
  }

  try {
    const result = await debugPreviewAll(task);
    return c.json({ debug: true, task, result });
  } catch (error) {
    console.error('Debug preview failed:', error);
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

app.post('/admin/kill/:agentId', async (c) => {
  const agentId = c.req.param('agentId');
  const agent = AGENT_REGISTRY.find((a) => a.name === agentId);
  if (!agent) {
    return c.json({ error: `unknown agent '${agentId}'` }, 404);
  }
  const res = await fetch(`${agent.url}/admin/kill`, { method: 'POST' });
  const json = await res.json().catch(() => ({}));
  return c.json(json, res.status as 200 | 404 | 500);
});

app.post('/admin/revive/:agentId', async (c) => {
  const agentId = c.req.param('agentId');
  const agent = AGENT_REGISTRY.find((a) => a.name === agentId);
  if (!agent) {
    return c.json({ error: `unknown agent '${agentId}'` }, 404);
  }
  const res = await fetch(`${agent.url}/admin/revive`, { method: 'POST' });
  const json = await res.json().catch(() => ({}));
  return c.json(json, res.status as 200 | 404 | 500);
});

// Targeted demo override: force exactly one agent to fail (e.g. the staked
// formatter) while every other selected agent still runs the real judge —
// isolates the stake+slash mechanic from the older abort-everything path,
// which is what a global force-fail would trigger instead. Registered
// before /admin/quality-gate/:mode below — 'target-clear' would otherwise be
// captured by that route's :mode param, since both are one path segment.
app.post('/admin/quality-gate/target/:agent', (c) => {
  const agent = c.req.param('agent');
  if (!AGENT_REGISTRY.some((a) => a.name === agent)) {
    return c.json({ error: `unknown agent '${agent}'` }, 404);
  }
  setForcedFailAgent(agent);
  console.log(`⚙ quality gate targeted override: '${agent}' will forcibly fail`);
  return c.json({ status: 'ok', forcedFailAgent: agent });
});
app.post('/admin/quality-gate/target-clear', (c) => {
  setForcedFailAgent(null);
  console.log('⚙ quality gate targeted override cleared');
  return c.json({ status: 'ok', forcedFailAgent: null });
});

// Demo/testing lever for the quality gate — mirrors the agent kill switch.
// 'auto' runs the real Groq judge; 'pass'/'fail' force the outcome so test
// cases like "bad answer -> no payment" are reproducible on demand.
const QUALITY_GATE_MODES: QualityGateMode[] = ['auto', 'pass', 'fail'];
app.post('/admin/quality-gate/:mode', (c) => {
  const mode = c.req.param('mode') as QualityGateMode;
  if (!QUALITY_GATE_MODES.includes(mode)) {
    return c.json({ error: `invalid mode '${mode}' — use auto, pass, or fail` }, 400);
  }
  setQualityGateMode(mode);
  console.log(`⚙ quality gate mode set to '${mode}' via admin endpoint`);
  return c.json({ status: 'ok', qualityGateMode: mode });
});
app.get('/admin/quality-gate', (c) => {
  return c.json({ qualityGateMode: getQualityGateMode(), forcedFailAgent: getForcedFailAgent() });
});

// Judge-triggerable self-test for the replay guard — fires N concurrent
// /redeem calls at one real agent with the same (synthetic) group+index
// proof and shows the guard let exactly one through. See selfTestReplay.ts.
app.post('/self-test/replay', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const agentName =
    typeof body?.agent === 'string' && body.agent.trim() ? body.agent.trim() : AGENT_REGISTRY[0]?.name;
  const n = typeof body?.n === 'number' && body.n >= 2 ? Math.min(Math.floor(body.n), 20) : 5;

  if (!agentName) {
    return c.json({ error: 'no agents registered' }, 400);
  }

  try {
    const result = await selfTestReplay(agentName, n);
    return c.json(result);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

app.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'router', uptime: process.uptime() });
});

app.get('/balances', async (c) => {
  const balances = await getAllBalances();
  return c.json({ balances });
});

// Lets the UI (and anyone else) discover the registered agents without
// hardcoding names — adding an agent to shared/constants.ts shows up here
// automatically.
app.get('/agents', (c) => {
  return c.json({
    agents: AGENT_REGISTRY.map((a) => ({ name: a.name, url: a.url, description: a.description, dependsOn: a.dependsOn ?? [] })),
  });
});

// Minimal UI — served as static files from ../ui, index.html at '/'.
app.use('/*', serveStatic({ root: '../ui', index: 'index.html' }));

app.notFound((c) => {
  return c.json({ error: 'Endpoint not found', path: c.req.path }, 404);
});

serve({ fetch: app.fetch, port }, () => {
  console.log(`\n✅ router running at http://localhost:${port}\n`);
});
