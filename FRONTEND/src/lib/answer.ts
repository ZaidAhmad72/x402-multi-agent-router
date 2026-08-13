// Turns the raw /route or /debug/preview response into what the user-facing
// chat view actually renders: readable answer sections (one per agent that
// ran, using that agent's real output shape — see BV_UncZ/agents/*/handlers/
// work.ts for the *Output interfaces this mirrors) and a flat trace of steps
// for the "what did it do" dropdown. The dev view keeps rendering its own
// pre-built HTML string independently; this is only for the new user view.

import type { AgentResults, ReceiptRow, RouteResponseData } from '../types';

export interface AnswerSection {
  agent: string;
  title: string;
  bodyHtml: string;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderResearch(output: any): AnswerSection {
  const findings = Array.isArray(output.findings) ? output.findings : [];
  const body = findings.length
    ? `<ul class="answer-list">${findings
        .map(
          (f: any) =>
            `<li>${escapeHtml(f.point ?? JSON.stringify(f))}${
              f.source ? `<span class="answer-source"> — ${escapeHtml(String(f.source))}</span>` : ''
            }</li>`
        )
        .join('')}</ul>`
    : `<p class="answer-empty">No findings returned.</p>`;
  return { agent: 'research', title: 'Research findings', bodyHtml: body };
}

function renderWriter(output: any): AnswerSection {
  const title = output.summary?.title || 'Summary';
  const body = String(output.summary?.body || '')
    .split('\n')
    .filter(Boolean)
    .map((p: string) => `<p>${escapeHtml(p)}</p>`)
    .join('');
  return { agent: 'writer', title, bodyHtml: body || '<p class="answer-empty">No summary returned.</p>' };
}

function renderWeather(output: any): AnswerSection {
  const parts = [
    `<strong>${escapeHtml(output.resolvedName || output.location || 'Unknown location')}</strong>`,
    output.condition ? escapeHtml(String(output.condition)) : null,
    typeof output.temperatureCelsius === 'number' ? `${output.temperatureCelsius}°C` : null,
    typeof output.windSpeedKmh === 'number' ? `wind ${output.windSpeedKmh} km/h` : null,
  ].filter(Boolean);
  let body = `<p>${parts.join(' · ')}</p>`;
  if (!output.live && output.note) body += `<p class="answer-note">${escapeHtml(String(output.note))}</p>`;
  return { agent: 'weather', title: 'Weather', bodyHtml: body };
}

function renderFormatter(output: any): AnswerSection {
  const rows = Array.isArray(output.conversions) ? output.conversions : [];
  const body =
    `<p>${output.sourceAmount ?? ''} ${escapeHtml(String(output.sourceCurrency ?? ''))} equals:</p>` +
    `<ul class="answer-list">${rows
      .map((r: any) => `<li>${escapeHtml(String(r.currency))}: ${r.amount}</li>`)
      .join('')}</ul>` +
    (!output.live && output.note ? `<p class="answer-note">${escapeHtml(String(output.note))}</p>` : '');
  return { agent: 'formatter', title: 'Currency conversion', bodyHtml: body };
}

function renderAnalysis(output: any): AnswerSection {
  const body = String(output.text || '')
    .split('\n')
    .filter(Boolean)
    .map((p: string) => `<p>${escapeHtml(p)}</p>`)
    .join('');
  return { agent: 'analysis', title: 'Analysis', bodyHtml: body || '<p class="answer-empty">No analysis returned.</p>' };
}

const RENDERERS: Record<string, (output: any) => AnswerSection> = {
  research: renderResearch,
  writer: renderWriter,
  weather: renderWeather,
  formatter: renderFormatter,
  analysis: renderAnalysis,
};

// Lead with the agents that read as a direct answer (writer's write-up,
// analysis's plain-language synthesis), then the specific data agents, and
// close with raw research findings as supporting detail/citations.
const AGENT_ORDER = ['writer', 'analysis', 'weather', 'formatter', 'research'];

export function buildAnswerSections(result: AgentResults | undefined): AnswerSection[] {
  if (!result) return [];
  const present = Object.keys(result);
  const ordered = [...AGENT_ORDER.filter((a) => present.includes(a)), ...present.filter((a) => !AGENT_ORDER.includes(a))];

  return ordered.map((name) => {
    const output = result[name];
    if (output?.outcome === 'slashed') {
      return {
        agent: name,
        title: `${name} (slashed)`,
        bodyHtml: `<p class="answer-note">Output failed the quality check — payment was slashed back to you. ${escapeHtml(
          String(output.reason || '')
        )}</p>`,
      };
    }
    const renderer = RENDERERS[name];
    if (renderer) return renderer(output);
    return { agent: name, title: name, bodyHtml: `<pre>${escapeHtml(JSON.stringify(output, null, 2))}</pre>` };
  });
}

// Steps shown in the collapsible "what it did" trace under each answer.
// Combines the live WebSocket progress log (real-time phase narration from
// router/index.ts's sendProgress calls) with a few lines synthesized
// straight from the final response, so the trace still has real content
// even if the WS stream dropped a message or (in preview mode) never ran.
export function buildRouteSteps(data: RouteResponseData, liveLogs: string[], isPreview: boolean): string[] {
  const steps: string[] = [...liveLogs];

  if (isPreview) {
    steps.push('Ran a free trial call to each selected agent — no payment, no atomic group');
  }

  for (const v of data.qualityVerdicts ?? []) {
    steps.push(`${v.ok ? 'Passed' : 'Failed'} quality check — ${v.agent}${v.reason ? `: ${v.reason}` : ''}`);
  }
  if (data.settlement) {
    steps.push(`Settled one atomic payment group on-chain — round ${data.settlement.confirmedRound}`);
  }
  for (const r of (data.receipt ?? []) as ReceiptRow[]) {
    const verb = r.outcome === 'paid' ? 'Paid' : r.outcome === 'slashed' ? 'Slashed' : r.outcome;
    steps.push(`${verb} ${r.agent} — $${r.amountUsd.toFixed(2)}`);
  }
  if (data.error) steps.push(`Error: ${data.error}`);

  return Array.from(new Set(steps));
}
