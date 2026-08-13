import type { Balance, Phase } from '../../types';

export interface UserRightPanelProps {
  open: boolean;
  currentPhase: Phase;
  balances: Balance[];
}

const PHASES: { key: Phase; label: string; n: number; doneWhen: Phase[] }[] = [
  { key: 'QUALITY', label: 'QUALITY', n: 1, doneWhen: ['QUOTE', 'SETTLE', 'REDEEMED'] },
  { key: 'QUOTE', label: 'QUOTE', n: 2, doneWhen: ['SETTLE', 'REDEEMED'] },
  { key: 'SETTLE', label: 'SETTLE', n: 3, doneWhen: ['REDEEMED'] },
  { key: 'REDEEM', label: 'REDEEM', n: 4, doneWhen: [] },
];

export default function UserRightPanel({ open, currentPhase, balances }: UserRightPanelProps) {
  return (
    <div className={`uv-right ${open ? 'open' : ''}`}>
      <div className="uv-panel">
        <h3>Phase</h3>
        <div className="uv-phase-grid">
          {PHASES.map((p) => {
            const isActive = currentPhase === p.key || (p.key === 'REDEEM' && currentPhase === 'REDEEM');
            const isDone = p.doneWhen.includes(currentPhase) || (p.key === 'REDEEM' && currentPhase === 'REDEEMED');
            return (
              <div key={p.key} className={`uv-phase-chip ${isActive ? 'active' : isDone ? 'done' : ''}`}>
                <div className="n">{p.n}</div>
                {p.label}
              </div>
            );
          })}
        </div>
      </div>

      <div className="uv-panel">
        <h3>Wallet balances</h3>
        {balances.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading…</div>}
        {balances.map((b) => (
          <div key={b.name} className="uv-wallet-row">
            <div>
              <div className="uv-wallet-name">{b.name}</div>
              <div className="uv-wallet-addr">{b.address ? `${b.address.substring(0, 6)}…` : '—'}</div>
            </div>
            <div className="uv-wallet-amounts">
              <span className="algo">{b.algo.toFixed(3)} ALGO</span>
              <span className="usdc">{b.usdc.toFixed(2)} USDC</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
