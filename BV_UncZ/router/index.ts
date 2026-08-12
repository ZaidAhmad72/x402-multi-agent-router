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

  if (!task) {
    return c.json({ error: 'task is required' }, 400);
  }
  if (maxSpend === undefined) {
    return c.json({ error: 'maxSpend is required' }, 400);
  }

  let quotePhase;
  try {
    const registry = await selectAgents(task);
    quotePhase = await quoteAgents(registry);
  } catch (error) {
    if (error instanceof LivenessError) {
      console.error(`✗ ${error.message}`);
      return c.json({ error: error.message, phase: 'QUOTE', zeroSpend: true }, 502);
    }
    console.error('Unexpected error in QUOTE phase:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }

  let settlement;
  try {
    settlement = await settleGroup(quotePhase, maxSpend);
  } catch (error) {
    if (error instanceof BudgetExceededError || error instanceof GroupTooLargeError) {
      console.error(`✗ ${error.message}`);
      return c.json({ error: error.message, phase: 'QUOTE', zeroSpend: true }, 400);
    }
    console.error('Unexpected error in SETTLE phase:', error);
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('underflow on subtracting')) {
      return c.json(
        {
          error:
            'Settlement failed: the router wallet (ROUTER_ADDR) does not have enough testnet USDC to pay all agents. Fund it and retry — nothing was spent.',
          phase: 'QUOTE',
          zeroSpend: true,
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
    return c.json({
      phase: 'REDEEMED',
      task,
      maxSpend,
      quotes: quotePhase.quotes,
      totalUsd: quotePhase.totalUsd,
      totalMicroUsdc: quotePhase.totalMicroUsdc,
      settlement,
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

app.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'router', uptime: process.uptime() });
});

app.get('/balances', async (c) => {
  const balances = await getAllBalances();
  return c.json({ balances });
});

// Minimal UI — served as static files from ../ui, index.html at '/'.
app.use('/*', serveStatic({ root: '../ui', index: 'index.html' }));

app.notFound((c) => {
  return c.json({ error: 'Endpoint not found', path: c.req.path }, 404);
});

serve({ fetch: app.fetch, port }, () => {
  console.log(`\n✅ router running at http://localhost:${port}\n`);
});
