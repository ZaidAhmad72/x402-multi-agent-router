/**
 * Execution Plan DAG — makes `selectAgents(task)`'s already-working dynamic,
 * capability-based agent selection visible as a dependency graph, and makes
 * the planner group-size aware.
 *
 * Deterministic, derived from the `AgentRegistryEntry[]` selectAgents already
 * returns — no second LLM call, no network call, zero added latency and zero
 * new failure point in the hot path.
 *
 * The genuinely novel part: the plan determines the atomic group size, and
 * the group is hard-capped at 16 transactions (same limit settle.ts enforces
 * authoritatively). So the planner forecasts N + 2 transaction slots and
 * checks that against the cap BEFORE anything is quoted or signed. Planning,
 * pricing, and settlement are constrained by the same primitive. This
 * forecast is advisory and runs on the selected subset; the gate in
 * settle.ts is authoritative and runs on what is actually about to be
 * signed — two checks at two layers is correct, not redundant.
 *
 * No fixed complexity tiers — an earlier sketch bucketed tasks into levels
 * 1-4 by agent count; cut, because the boundaries are arbitrary and with five
 * agents in the registry the top tier is unreachable. Report the plan's
 * actual shape instead: agent count, layer count, maximum parallel width.
 */

import type { AgentRegistryEntry } from '../shared/constants';

export interface PlanNode {
  name: string;
  description: string;
  dependsOn: string[];
  layer: number; // 0 = no dependencies, runs first
}

export interface PlanEdge {
  from: string;
  to: string;
}

export interface GroupForecast {
  agentTxns: number; // = nodes.length
  routingFeeTxn: number; // always 1
  feePayerTxn: number; // always 1
  total: number; // agentTxns + 2
  limit: number; // 16
  headroom: number; // limit - total
  withinLimit: boolean;
}

export interface ExecutionPlan {
  task: string;
  nodes: PlanNode[];
  edges: PlanEdge[];
  layers: string[][]; // agent names grouped by layer, in execution order
  shape: {
    agentCount: number;
    layerCount: number;
    maxParallelWidth: number; // widest layer — the visible fan-out
  };
  groupForecast: GroupForecast;
}

const GROUP_TXN_LIMIT = 16;

/**
 * Pure and synchronous. No network, no LLM, no mutation.
 *
 * Layer assignment is longest-path, not naive breadth-first: a node's layer
 * is 1 + max(layer of its dependencies), 0 if it has none. Only dependencies
 * present in the passed registry count — selectAgents returns a subset, and
 * a dependsOn entry pointing at an agent that wasn't selected is ignored
 * rather than crashing or forcing a phantom layer (e.g. `formatter` declares
 * dependsOn: ['writer']; a task selecting formatter without writer must
 * still produce a valid plan).
 *
 * Guards against cycles: the registry is hand-maintained and a future edit
 * could introduce one. The fixed-point iteration is capped at
 * registry.length passes; if it hasn't converged by then, every node is
 * flattened to layer 0 and a warning is logged. Fails open — never throws.
 */
export function buildPlan(task: string, registry: AgentRegistryEntry[]): ExecutionPlan {
  const namesInRegistry = new Set(registry.map((a) => a.name));
  const filteredDeps = new Map<string, string[]>(
    registry.map((a) => [a.name, (a.dependsOn ?? []).filter((d) => namesInRegistry.has(d))])
  );

  const layer = new Map<string, number>(registry.map((a) => [a.name, 0]));
  let converged = false;
  for (let pass = 0; pass < registry.length; pass++) {
    let changed = false;
    for (const a of registry) {
      const deps = filteredDeps.get(a.name) ?? [];
      if (deps.length === 0) continue;
      const proposed = 1 + Math.max(...deps.map((d) => layer.get(d) ?? 0));
      if (proposed !== layer.get(a.name)) {
        layer.set(a.name, proposed);
        changed = true;
      }
    }
    if (!changed) {
      converged = true;
      break;
    }
  }
  if (!converged) {
    console.warn(
      `plan.ts: layer assignment did not converge within ${registry.length} pass(es) — ` +
        'possible dependsOn cycle in AGENT_REGISTRY. Flattening every node to layer 0.'
    );
    for (const name of layer.keys()) layer.set(name, 0);
  }

  const nodes: PlanNode[] = registry.map((a) => ({
    name: a.name,
    description: a.description,
    dependsOn: filteredDeps.get(a.name) ?? [],
    layer: layer.get(a.name) ?? 0,
  }));

  const edges: PlanEdge[] = nodes.flatMap((n) => n.dependsOn.map((dep) => ({ from: dep, to: n.name })));

  const maxLayer = nodes.reduce((max, n) => Math.max(max, n.layer), 0);
  const layers: string[][] = Array.from({ length: nodes.length > 0 ? maxLayer + 1 : 0 }, () => []);
  for (const n of nodes) layers[n.layer].push(n.name);

  const agentTxns = nodes.length;
  const total = agentTxns + 2; // + routing fee leg + pooled fee-payer txn, mirroring settle.ts's groupSize
  const groupForecast: GroupForecast = {
    agentTxns,
    routingFeeTxn: 1,
    feePayerTxn: 1,
    total,
    limit: GROUP_TXN_LIMIT,
    headroom: GROUP_TXN_LIMIT - total,
    withinLimit: total <= GROUP_TXN_LIMIT,
  };

  return {
    task,
    nodes,
    edges,
    layers,
    shape: {
      agentCount: nodes.length,
      layerCount: layers.length,
      maxParallelWidth: layers.reduce((max, l) => Math.max(max, l.length), 0),
    },
    groupForecast,
  };
}
