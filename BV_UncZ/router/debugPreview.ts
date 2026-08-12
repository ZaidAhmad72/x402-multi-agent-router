/**
 * DEBUG ONLY — no payment, no atomic group, no groupId/index proof. Runs every
 * registered agent (in registry/dependency order) via its unprotected
 * /debug/preview route, so the real pipeline logic can be exercised while
 * wallets are unfunded. Registry-driven — adding an agent to
 * shared/constants.ts picks it up here automatically, no changes needed.
 * Not part of the real product surface; remove before any real demo/judging.
 */

import { AGENT_REGISTRY } from '../shared/constants';
import { previewOne } from './previewCall';

export async function debugPreviewAll(task: string): Promise<Record<string, any>> {
  const outputs: Record<string, any> = {};
  for (const entry of AGENT_REGISTRY) {
    outputs[entry.name] = await previewOne(entry.url, entry.buildInput(task, outputs));
  }
  return outputs;
}
