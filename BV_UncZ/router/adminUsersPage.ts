/**
 * GET / — a simple, server-rendered (no client JS) page listing every
 * registered user and their reputation score. Requested as "just a simple
 * page" at the router's root, the same place the old ui/index.html used to
 * live before it was dropped (see router/index.ts's comment on that). No
 * auth: matches the rest of this repo's admin routes (kill switch, quality
 * gate override, guard on/off) on a shared testnet demo, and nothing
 * sensitive is shown here -- usernames, names, reputation, join date. Never
 * the password hash.
 */

import { usersCollection } from './db';
import { REPUTATION_MAX, categorizeReputation } from './userReputation';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function renderUsersPage(): Promise<string> {
  const users = await usersCollection.find({}).sort({ reputation: -1 }).toArray();

  const rows = users
    .map((u) => {
      const score = typeof u.reputation === 'number' ? u.reputation : undefined;
      const { label } = categorizeReputation(score ?? 8);
      const scoreText = score === undefined ? '—' : score.toFixed(2);
      const created = u.createdAt ? new Date(u.createdAt).toLocaleString() : '—';
      return `
        <tr>
          <td>${escapeHtml(u.username)}</td>
          <td>${escapeHtml(u.name ?? '')}</td>
          <td class="score"><span class="pill pill-${label.toLowerCase()}">${scoreText} / ${REPUTATION_MAX}</span></td>
          <td>${escapeHtml(label)}</td>
          <td class="muted">${escapeHtml(created)}</td>
        </tr>`;
    })
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Users &amp; Reputation</title>
<style>
  :root {
    --bg: #0b0d12; --panel: #171a21; --border: #2a2f3a; --text: #e6e8eb; --muted: #8b93a1;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font-family: -apple-system, Segoe UI, Roboto, sans-serif; padding: 32px; }
  .wrap { max-width: 900px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .subtitle { color: var(--muted); font-size: 13px; margin: 0 0 24px; }
  table { width: 100%; border-collapse: collapse; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
  th, td { text-align: left; padding: 10px 14px; font-size: 13.5px; border-bottom: 1px solid var(--border); }
  th { color: var(--muted); text-transform: uppercase; font-size: 11px; letter-spacing: 0.04em; }
  tr:last-child td { border-bottom: none; }
  .muted { color: var(--muted); }
  .empty { color: var(--muted); padding: 20px; text-align: center; }
  .pill { display: inline-block; padding: 2px 10px; border-radius: 10px; font-weight: 600; font-size: 12.5px; }
  .pill-excellent { background: rgba(62,207,142,0.18); color: #3ecf8e; }
  .pill-good { background: rgba(79,142,247,0.18); color: #4f8ef7; }
  .pill-fair { background: rgba(230,180,60,0.18); color: #e6b43c; }
  .pill-poor { background: rgba(247,150,80,0.18); color: #f79650; }
  .pill-untrusted { background: rgba(247,110,110,0.18); color: #f76e6e; }
</style>
</head>
<body>
  <div class="wrap">
    <h1>Users &amp; Reputation</h1>
    <p class="subtitle">${users.length} user(s) — see docs/USER-REPUTATION.md for how the score is calculated.</p>
    <table>
      <thead>
        <tr><th>Username</th><th>Name</th><th>Reputation</th><th>Category</th><th>Joined</th></tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="5" class="empty">No users yet.</td></tr>'}
      </tbody>
    </table>
  </div>
</body>
</html>`;
}
