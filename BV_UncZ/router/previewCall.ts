/**
 * Shared helper for calling an agent's unprotected /debug/preview route —
 * used by debugPreview.ts (no-payment demo mode) and qualityGate.ts (the
 * pre-settlement trial run). No payment, no atomic group, no proof.
 */
export async function previewOne(url: string, body: unknown): Promise<any> {
  const res = await fetch(`${url}/debug/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody?.error ?? `preview call to ${url} failed: HTTP ${res.status}`);
  }
  return res.json();
}
