/**
 * Formatter Agent — x402-gated service
 *
 * POST /work — text -> rendered chart. $0.01 USDC. Deterministic, NO LLM.
 * Structure mirrors reference/x402-starter/x402-demo-server/index.ts exactly;
 * only the route table, port, and wallet differ per agent.
 */

import { config } from 'dotenv';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { paymentMiddleware } from '@x402/hono';
import { x402ResourceServer, HTTPFacilitatorClient } from '@x402/core/server';
import type { ResourceServerExtension } from '@x402/core/types';
import { ExactAvmScheme } from '@x402/avm/exact/server';
import { ALGORAND_TESTNET_CAIP2 } from '@x402/avm';
import { bazaarResourceServerExtension } from '@x402-avm/extensions';

import { handleFormatterWork } from './handlers/work';
import { handleFormatterRedeem } from './handlers/redeem';
import { runFormatter } from './handlers/work';
import { isKilled, kill, revive } from './killswitch';
import createPaymentConfig, { EndpointConfig } from './endpoints.config';

config();

const AGENT_NAME = 'formatter';
const avmAddress = process.env.AVM_ADDRESS;
const facilitatorUrl = process.env.FACILITATOR_URL;
const port = parseInt(process.env.PORT || '4003', 10);

if (!avmAddress || !facilitatorUrl) {
  console.error(
    '❌ Missing required environment variables:\n' +
    '   - AVM_ADDRESS (this agent\'s wallet receiving payments)\n' +
    '   - FACILITATOR_URL (x402 facilitator service)'
  );
  process.exit(1);
}

console.log('\n' + '═'.repeat(60));
console.log(`x402 AGENT — ${AGENT_NAME.toUpperCase()} (deterministic, no LLM)`);
console.log('═'.repeat(60));
console.log('Configuration:');
console.log(`  Receiver Address: ${avmAddress}`);
console.log(`  Facilitator: ${facilitatorUrl}`);
console.log(`  Port: ${port}`);
console.log('═'.repeat(60) + '\n');

const facilitatorClient = new HTTPFacilitatorClient({ url: facilitatorUrl });
const x402Server = new x402ResourceServer(facilitatorClient)
  .register(ALGORAND_TESTNET_CAIP2, new ExactAvmScheme())
  .registerExtension(bazaarResourceServerExtension as unknown as ResourceServerExtension);

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
  if (c.req.header('payment-signature')) {
    console.log('  ✓ Payment-Signature header detected');
  }
  await next();
  console.log(`  Response: ${c.res.status}`);
});

const paymentConfig: EndpointConfig = createPaymentConfig(avmAddress);
console.log('📋 Registered Payment-Protected Endpoints:');
Object.entries(paymentConfig).forEach(([route, cfg]) => {
  const price = cfg.accepts[0]?.price || 'unknown';
  console.log(`   ${route} - ${price} USDC - ${cfg.description}`);
});
console.log();

// Kill switch — a killed agent stops responding on its business routes, so
// the router's quote phase fails and the group is never built. Admin routes
// stay reachable regardless, otherwise there'd be no way to revive.
app.use('/work', async (c, next) => {
  if (isKilled()) {
    return c.json({ error: `${AGENT_NAME} agent is killed (demo kill switch)` }, 503);
  }
  await next();
});
app.use('/redeem', async (c, next) => {
  if (isKilled()) {
    return c.json({ error: `${AGENT_NAME} agent is killed (demo kill switch)` }, 503);
  }
  await next();
});

app.use(paymentMiddleware(paymentConfig as any, x402Server));

// Payment-protected route — only reached after payment is verified
app.post('/work', handleFormatterWork);

// Outbound-leg redeem — proof is X-PAYMENT-GROUP / X-PAYMENT-INDEX, verified
// on-chain by this agent, not by trusting the router.
app.post('/redeem', handleFormatterRedeem);

app.post('/admin/kill', (c) => {
  kill();
  console.log(`⚠ ${AGENT_NAME} agent KILLED via admin endpoint`);
  return c.json({ status: 'killed', agent: AGENT_NAME });
});
app.post('/admin/revive', (c) => {
  revive();
  console.log(`✓ ${AGENT_NAME} agent REVIVED via admin endpoint`);
  return c.json({ status: 'alive', agent: AGENT_NAME });
});

// DEBUG ONLY — no payment gate. Runs the same work function so the router's
// debug preview can show real answers while wallets are unfunded. Not part
// of the real product surface; remove before any real demo/judging.
app.post('/debug/preview', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const text: string = typeof body?.text === 'string' ? body.text : '';
    return c.json(await runFormatter(text));
  } catch (error) {
    console.error('Error in formatter debug/preview:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Internal server error' }, 500);
  }
});

// Public endpoints — no payment required
app.get('/health', (c) => {
  return c.json({ status: 'ok', service: `agent-${AGENT_NAME}`, uptime: process.uptime(), killed: isKilled() });
});

app.get('/info', (c) => {
  return c.json({
    service: `agent-${AGENT_NAME}`,
    version: '1.0.0',
    network: 'Algorand TestNet',
    receiver: avmAddress,
    endpoints: Object.keys(paymentConfig),
  });
});

app.notFound((c) => {
  return c.json(
    { error: 'Endpoint not found', path: c.req.path, hint: 'Try GET /health or GET /info' },
    404
  );
});

serve({ fetch: app.fetch, port }, () => {
  console.log(`\n✅ ${AGENT_NAME} agent running at http://localhost:${port}\n`);
});
