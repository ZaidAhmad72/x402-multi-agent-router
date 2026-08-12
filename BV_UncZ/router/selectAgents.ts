/**
 * Dynamic agent selection — decides which of the three registered agents a
 * task actually needs, so quote/settle N varies per request instead of
 * always being fixed at 3. Ported from reference-implementation's
 * llmExtractor.ts pattern (single Groq call, JSON mode, temperature 0).
 *
 * Fails open: any error (missing key, network, bad JSON) falls back to all
 * three agents — the previous fixed behaviour — so a Groq outage never
 * blocks the route, only removes the optimization.
 */

import { AGENT_REGISTRY, type AgentRegistryEntry } from '../shared/constants';

const GROQ_MODEL = 'llama-3.3-70b-versatile';
const ALL_AGENT_NAMES = AGENT_REGISTRY.map((a) => a.name);

const SYSTEM_PROMPT = `You decide which agents a task-routing system needs to call for a given task.
Available agents:
- "research": gathers sourced factual findings about a topic. Needed for any informational, explanatory, or "tell me about X" task.
- "writer": synthesizes research findings into a coherent written summary. Needed whenever "research" is needed, to turn raw findings into a readable answer.
- "formatter": deterministic, non-LLM live currency conversion and chart rendering. ONLY needed when the task explicitly involves converting or comparing a monetary amount between currencies.

Respond with ONLY a JSON object, no other text: {"agents": string[]} — a subset of ["research","writer","formatter"].
Rules:
- If "writer" is included, "research" must be included too (writer needs findings to write from).
- If the task has no clear currency-conversion component, omit "formatter".
- If nothing else fits, default to {"agents":["research","writer"]}.`;

function normalize(names: unknown): string[] {
  const raw = Array.isArray(names) ? names.filter((n): n is string => typeof n === 'string' && ALL_AGENT_NAMES.includes(n)) : [];
  const set = new Set(raw);
  if (set.has('writer')) set.add('research');
  if (set.size === 0) {
    set.add('research');
    set.add('writer');
  }
  return ALL_AGENT_NAMES.filter((n) => set.has(n));
}

/**
 * Returns the subset of AGENT_REGISTRY (in registry order) that the task
 * needs. Falls back to the full registry on any Groq failure.
 */
export async function selectAgents(task: string): Promise<AgentRegistryEntry[]> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.log('  (agent selection: GROQ_API_KEY not set — using all agents)');
    return AGENT_REGISTRY;
  }

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: task },
        ],
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) throw new Error(`Groq agent-selection request failed: ${res.status}`);

    const data = (await res.json()) as any;
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) throw new Error('Groq agent-selection returned no content');

    const names = normalize(JSON.parse(raw)?.agents);
    console.log(`  agent selection: [${names.join(', ')}] for task "${task}"`);
    return AGENT_REGISTRY.filter((a) => names.includes(a.name));
  } catch (err) {
    console.log(`  (agent selection failed, using all agents: ${(err as Error).message})`);
    return AGENT_REGISTRY;
  }
}
