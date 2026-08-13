/**
 * Dynamic agent selection — decides which registered agents a task actually
 * needs, so quote/settle N varies per request instead of always being fixed.
 * Ported from reference-implementation's llmExtractor.ts pattern (single
 * Groq call, JSON mode, temperature 0).
 *
 * Registry-driven: the prompt is built from each AgentRegistryEntry's own
 * `description`, and dependencies are resolved from `dependsOn` — adding a
 * new agent to shared/constants.ts is picked up here automatically, no
 * changes needed in this file.
 *
 * Fails open: any error (missing key, network, bad JSON, or an empty/invalid
 * selection) falls back to the full registry — the previous fixed behaviour
 * — so a Groq outage never blocks the route, only removes the optimization.
 */

import { AGENT_REGISTRY, type AgentRegistryEntry } from '../shared/constants';

const GROQ_MODEL = 'llama-3.3-70b-versatile';

function buildSystemPrompt(): string {
  const lines = AGENT_REGISTRY.map((a) => `- "${a.name}": ${a.description}`).join('\n');
  const names = AGENT_REGISTRY.map((a) => `"${a.name}"`).join(', ');
  return `You decide which agents a task-routing system needs to call for a given task.
Available agents:
${lines}

Respond with ONLY a JSON object, no other text: {"agents": string[]} — a subset of [${names}].
Rules:
- If an agent is included, its dependencies must be included too (the task description says what each agent needs).
- Only include an agent if the task genuinely needs it.
- If a more specific agent already fully covers part of the task (e.g. a dedicated weather or currency
  agent), do NOT also include a general-purpose research/writer pair for that same part — pick the
  specific one, not both. Only include research/writer for parts of the task no specific agent covers.
- If nothing clearly fits, return an empty array — the caller will fall back to a safe default.`;
}

/** Adds every transitive dependsOn of each selected agent. */
function withDependencies(names: Set<string>): Set<string> {
  const byName = new Map(AGENT_REGISTRY.map((a) => [a.name, a]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const name of [...names]) {
      for (const dep of byName.get(name)?.dependsOn ?? []) {
        if (!names.has(dep)) {
          names.add(dep);
          changed = true;
        }
      }
    }
  }
  return names;
}

// The selector prompt already tells the LLM to prefer a specific agent
// (weather/formatter) over the general research/writer pair when the
// specific one covers the task -- but LLM instruction-following isn't 100%
// reliable, and the failure mode is expensive: research/writer get pulled
// into a purely weather/currency task, sometimes genuinely produce weak
// output for a question outside their real need (verified live: "Lacks
// specific factual data" / "Not focused on research summary"), and since
// they're unstaked, that aborts the WHOLE route even though the agents that
// actually mattered were fine. This is a deterministic backstop, not a
// suggestion: weather and formatter (+ analysis, which exists specifically
// to narrate their output) are a complete, self-sufficient answer on their
// own, so if either was picked, research/writer add cost and abort-risk
// without adding coverage -- drop them regardless of what the LLM said.
function dropRedundantGeneralAgents(names: Set<string>): Set<string> {
  if (names.has('weather') || names.has('formatter')) {
    names.delete('research');
    names.delete('writer');
  }
  return names;
}

function normalize(rawAgents: unknown): AgentRegistryEntry[] {
  const valid = new Set(AGENT_REGISTRY.map((a) => a.name));
  const picked = new Set(
    Array.isArray(rawAgents) ? rawAgents.filter((n): n is string => typeof n === 'string' && valid.has(n)) : []
  );
  const withDeps = dropRedundantGeneralAgents(withDependencies(picked));
  if (withDeps.size === 0) return AGENT_REGISTRY; // fail open — empty/invalid selection
  return AGENT_REGISTRY.filter((a) => withDeps.has(a.name));
}

/**
 * Returns the subset of AGENT_REGISTRY (in registry order) that the task
 * needs. Falls back to the full registry on any Groq failure or empty result.
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
          { role: 'system', content: buildSystemPrompt() },
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

    const selected = normalize(JSON.parse(raw)?.agents);
    console.log(`  agent selection: [${selected.map((a) => a.name).join(', ')}] for task "${task}"`);
    return selected;
  } catch (err) {
    console.log(`  (agent selection failed, using all agents: ${(err as Error).message})`);
    return AGENT_REGISTRY;
  }
}
