/**
 * DEBUG ONLY — no payment, no atomic group, no groupId/index proof. Pipelines
 * research -> writer -> formatter via each agent's unprotected /debug/preview
 * route, so the real pipeline logic can be exercised while wallets are
 * unfunded. Not part of the real product surface; remove before any real
 * demo/judging.
 */

import { AGENT_REGISTRY } from '../shared/constants';

function findAgentUrl(name: string): string {
  const agent = AGENT_REGISTRY.find((a) => a.name === name);
  if (!agent) throw new Error(`Unknown agent '${name}' in registry`);
  return agent.url;
}

async function previewOne(url: string, body: unknown) {
  const res = await fetch(`${url}/debug/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function debugPreviewAll(task: string) {
  const research = await previewOne(findAgentUrl('research'), { task });
  const writer = await previewOne(findAgentUrl('writer'), { task, findings: research.findings });
  const formatter = await previewOne(findAgentUrl('formatter'), { text: writer.summary?.body ?? '' });

  return { research, writer, formatter };
}
