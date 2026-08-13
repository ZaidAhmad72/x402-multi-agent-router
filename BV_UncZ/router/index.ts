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
import { createNodeWebSocket } from '@hono/node-ws';

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

import { connectDB } from './db';
import { authApp } from './auth';
import { historyApp } from './history';
import { ProcessEvent } from '../shared/types/history';

// Shared env file for all 5 agents + router (GROQ_API_KEY, MONGODB_URI —
// see BV_UncZ/.env's header comment). Wallet mnemonics stay in
// .env.wallets, loaded separately below.
config({ path: '../.env' });
config({ path: '../.env.wallets' });

const requiredWallets = [
  { name: 'Router', var: 'ROUTER_ADDR' },
  { name: 'Research Agent', var: 'AGENT1_ADDR' },
  { name: 'Writer Agent', var: 'AGENT2_ADDR' },
  { name: 'Formatter Agent', var: 'AGENT3_ADDR' },
  { name: 'Weather Agent', var: 'AGENT4_ADDR' },
  { name: 'Analysis Agent', var: 'AGENT5_ADDR' },
];
console.log('\n--- Wallet Configuration Check ---');
requiredWallets.forEach((w) => {
  const addr = process.env[w.var];
  if (addr) {
    console.log(`[OK] ${w.name} loaded: ${addr.substring(0, 10)}...`);
  } else {
    console.warn(`[WARN] ${w.name} (${w.var}) is missing from .env.wallets`);
  }
});
console.log('----------------------------------\n');

function isNetworkConnectivityError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.message.includes('fetch failed')) return true;
  const causeCode = (error as { cause?: { code?: string } }).cause?.code;
  return (
    typeof causeCode === 'string' &&
    (causeCode.startsWith('UND_ERR_CONNECT') ||
      causeCode === 'ENOTFOUND' ||
      causeCode === 'ECONNREFUSED' ||
      causeCode === 'ETIMEDOUT')
  );
}

const NETWORK_ERROR_MESSAGE =
  'Could not reach the Algorand testnet node (algonode.cloud) — this is a known, intermittent ' +
  'outage of the public node, not a code or funds problem. Nothing was signed or submitted. ' +
  'Wait a moment and retry.';

const port = parseInt(process.env.PORT || '4000', 10);

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

// Start MongoDB connection
connectDB();

app.route('/auth', authApp);
app.route('/history', historyApp);

// WebSocket Setup for live progress
const activeConnections = new Map<string, any>();
app.get('/ws/:username', upgradeWebSocket((c) => {
  const username = c.req.param('username');
  return {
    onOpen(_event, ws) {
      if (!username) return;
      activeConnections.set(username, ws);
      console.log(`WS Connected: ${username}`);
    },
    onClose() {
      if (!username) return;
      activeConnections.delete(username);
      console.log(`WS Disconnected: ${username}`);
    }
  };
}));

function sendProgress(username: string | undefined, message: string, eventsList: ProcessEvent[]) {
  console.log(`[PROGRESS] ${message}`);
  eventsList.push({ description: message, timestamp: Date.now() });
  if (username) {
    const ws = activeConnections.get(username);
    if (ws) {
      ws.send(JSON.stringify({ type: 'progress', message }));
    }
  }
}

// CORS
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
  if (c.req.path.startsWith('/ws')) return await next();
  if (c.req.path === '/balances') return await next(); // Silence the 3-second polling logs
  if (c.req.path === '/health') return await next();
  
  const timestamp = new Date().toISOString();
  console.log(`\n[${timestamp}] ${c.req.method.toUpperCase()} ${c.req.path}`);
  await next();
  console.log(`  Response: ${c.res.status}`);
});

app.post('/route', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const task = typeof body?.task === 'string' && body.task.trim() ? body.task.trim() : '';
  const maxSpend = typeof body?.maxSpend === 'number' ? body.maxSpend : undefined;
  const userAddr = typeof body?.userAddr === 'string' && body.userAddr.trim() ? body.userAddr.trim() : process.env.USER_ADDR;
  const username = typeof body?.username === 'string' && body.username.trim() ? body.username.trim() : undefined;
  const chatId = typeof body?.chatId === 'string' && body.chatId.trim() ? body.chatId.trim() : undefined;

  const processEvents: ProcessEvent[] = [];

  sendProgress(username, "API call received at POST /route", processEvents);
  sendProgress(username, "Validating input parameters...", processEvents);

  if (!task) {
    sendProgress(username, "Error: Task parameter is missing", processEvents);
    return c.json({ error: 'task is required' }, 400);
  }
  if (maxSpend === undefined) {
    sendProgress(username, "Error: maxSpend parameter is missing", processEvents);
    return c.json({ error: 'maxSpend is required' }, 400);
  }
  sendProgress(username, "Success: Input validation passed", processEvents);

  sendProgress(username, "Selecting agents for task...", processEvents);
  const registry = await selectAgents(task);
  sendProgress(username, `Success: ${registry.length} agent(s) selected for task execution`, processEvents);

  sendProgress(username, "Running quality gate check on selected agents...", processEvents);
  const qualityVerdicts = await runQualityGate(task, registry);
  const unstakedFailures = qualityVerdicts.filter((v) => !v.ok && !v.staked);
  if (unstakedFailures.length > 0) {
    const message = `Quality gate rejected ${unstakedFailures.length} agent output(s) before any payment`;
    console.error(`✗ ${message}`);
    sendProgress(username, `Error: ${message}`, processEvents);
    return c.json({ error: message, phase: 'QUALITY', zeroSpend: true, qualityVerdicts }, 502);
  }

  sendProgress(username, "Success: Quality gate passed successfully", processEvents);

  sendProgress(username, "Requesting quotes from agents...", processEvents);
  let quotePhase;
  try {
    quotePhase = await quoteAgents(registry);
    sendProgress(username, "Success: Received quotes from agents successfully", processEvents);
  } catch (error) {
    if (error instanceof LivenessError) {
      console.error(`✗ ${error.message}`);
      sendProgress(username, `Error: ${error.message}`, processEvents);
      return c.json({ error: error.message, phase: 'QUOTE', zeroSpend: true, qualityVerdicts }, 502);
    }
    console.error('Unexpected error in QUOTE phase:', error);
    if (isNetworkConnectivityError(error)) {
      sendProgress(username, `Error: Network connectivity issues`, processEvents);
      return c.json({ error: NETWORK_ERROR_MESSAGE, phase: 'QUOTE', zeroSpend: true, qualityVerdicts }, 502);
    }
    return c.json({ error: 'Internal server error' }, 500);
  }

  sendProgress(username, "Building atomic transaction group for settlement...", processEvents);
  let settlement;
  try {
    settlement = await settleGroup(quotePhase, maxSpend, qualityVerdicts, userAddr);
    sendProgress(username, "Success: Atomic settlement group successfully built and signed", processEvents);
  } catch (error) {
    if (error instanceof BudgetExceededError || error instanceof GroupTooLargeError) {
      console.error(`✗ ${error.message}`);
      sendProgress(username, `Error: ${error.message}`, processEvents);
      return c.json({ error: error.message, phase: 'QUOTE', zeroSpend: true, qualityVerdicts }, 400);
    }
    console.error('Unexpected error in SETTLE phase:', error);
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('underflow on subtracting')) {
      return c.json({
        error: 'Settlement failed: not enough testnet USDC. Nothing was spent.',
        phase: 'QUOTE', zeroSpend: true, qualityVerdicts
      }, 502);
    }
    if (message.includes('must optin')) {
      return c.json({
        error: 'Settlement failed: an agent wallet is not opted into USDC. Nothing was spent.',
        phase: 'QUOTE', zeroSpend: true, qualityVerdicts
      }, 502);
    }
    if (isNetworkConnectivityError(error)) {
      return c.json({ error: NETWORK_ERROR_MESSAGE, phase: 'QUOTE', zeroSpend: true, qualityVerdicts }, 502);
    }
    return c.json({ error: 'Internal server error' }, 500);
  }

  sendProgress(username, "Redeeming and verifying results on-chain...", processEvents);
  try {
    const result = await redeemAll(task, quotePhase.quotes, settlement);
    sendProgress(username, "Success: All results verified and redeemed on-chain", processEvents);
    c.header('X-Group-Id', settlement.groupId);
    c.header('X-Explorer-Url', settlement.explorerUrl);

    const receipt = settlement.perAgent.map((p) => ({
      agent: p.agent,
      outcome: p.outcome,
      amountUsd: Number(p.amountMicroUsdc) / 1_000_000,
      ...(p.outcome === 'slashed' ? { rebateToUser: userAddr, reason: p.reason } : {}),
    }));

    sendProgress(username, "Task completed successfully", processEvents);

    // Return Response
    return c.json({
      phase: 'REDEEMED',
      task, maxSpend,
      quotes: quotePhase.quotes,
      totalUsd: quotePhase.totalUsd,
      totalMicroUsdc: quotePhase.totalMicroUsdc,
      qualityVerdicts, settlement, receipt, result,
    });
  } catch (error) {
    const message = error instanceof RedeemError ? error.message : 'Internal server error during redeem';
    console.error(`✗ REDEEM incomplete: ${message}`);
    sendProgress(username, `Error during redeem: ${message}`, processEvents);
    return c.json({
      error: message, phase: 'SETTLED', settledButNotRedeemed: true,
      settlement, qualityVerdicts,
    }, 502);
  }
});

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

app.post('/admin/quality-gate/target/:agent', (c) => {
  const agent = c.req.param('agent');
  if (!AGENT_REGISTRY.some((a) => a.name === agent)) {
    return c.json({ error: `unknown agent '${agent}'` }, 404);
  }
  setForcedFailAgent(agent);
  return c.json({ status: 'ok', forcedFailAgent: agent });
});

app.post('/admin/quality-gate/target-clear', (c) => {
  setForcedFailAgent(null);
  return c.json({ status: 'ok', forcedFailAgent: null });
});

const QUALITY_GATE_MODES: QualityGateMode[] = ['auto', 'pass', 'fail'];
app.post('/admin/quality-gate/:mode', (c) => {
  const mode = c.req.param('mode') as QualityGateMode;
  if (!QUALITY_GATE_MODES.includes(mode)) {
    return c.json({ error: `invalid mode '${mode}'` }, 400);
  }
  setQualityGateMode(mode);
  return c.json({ status: 'ok', qualityGateMode: mode });
});
app.get('/admin/quality-gate', (c) => {
  return c.json({ qualityGateMode: getQualityGateMode(), forcedFailAgent: getForcedFailAgent() });
});

app.post('/self-test/replay', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const agentName = typeof body?.agent === 'string' && body.agent.trim() ? body.agent.trim() : AGENT_REGISTRY[0]?.name;
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

app.get('/agents', (c) => {
  return c.json({
    agents: AGENT_REGISTRY.map((a) => ({ name: a.name, url: a.url, description: a.description, dependsOn: a.dependsOn ?? [] })),
  });
});

// The frontend is the standalone Vite app in FRONTEND/ (proxies here on
// dev, its own build in production) — this router is API/WS-only, no
// static UI to serve.
app.notFound((c) => {
  return c.json({ error: 'Endpoint not found', path: c.req.path }, 404);
});

const server = serve({ fetch: app.fetch, port }, () => {
  console.log(`\n✅ router running at http://localhost:${port}\n`);
});
injectWebSocket(server);
