import { useState } from 'react';
import { ChevronRight, AlertTriangle } from 'lucide-react';
import type { Message } from '../../types';
import { buildAnswerSections } from '../../lib/answer';

function TraceList({ steps }: { steps: string[] }) {
  return (
    <div className="uv-trace-list">
      {steps.map((step, i) => {
        const failed = /^error:|^failed/i.test(step) || step.toLowerCase().startsWith('failed');
        return (
          <div key={i} className={`uv-trace-item ${failed ? 'fail' : 'ok'}`}>
            <span className="mark">{failed ? '✗' : '✓'}</span>
            <span>{step}</span>
          </div>
        );
      })}
    </div>
  );
}

function CollapsibleTrace({ steps }: { steps: string[] }) {
  const [open, setOpen] = useState(false);
  if (steps.length === 0) return null;
  return (
    <div className="uv-trace">
      <button className={`uv-trace-toggle ${open ? 'open' : ''}`} onClick={() => setOpen((o) => !o)}>
        <span className="chev"><ChevronRight size={13} /></span>
        {open ? 'Hide what I did' : `Worked through ${steps.length} step${steps.length === 1 ? '' : 's'}`}
      </button>
      {open && <TraceList steps={steps} />}
    </div>
  );
}

function CostTable({ msg }: { msg: Message }) {
  const receipt = msg.raw?.receipt;
  if (msg.isPreview) {
    return (
      <div className="uv-cost-table">
        <h5>Agents used</h5>
        <div className="uv-cost-row">
          <span className="uv-cost-agent" style={{ color: 'var(--text-muted)' }}>
            Preview run — no payment, nothing spent
          </span>
        </div>
      </div>
    );
  }
  if (!receipt || receipt.length === 0) return null;
  return (
    <div className="uv-cost-table">
      <h5>Agents used</h5>
      {receipt.map((r) => (
        <div key={r.agent} className="uv-cost-row">
          <span className="uv-cost-agent">{r.agent}</span>
          <span className="uv-cost-right">
            <span className="uv-cost-amount">${r.amountUsd.toFixed(2)}</span>
            <span className={`uv-pill ${r.outcome === 'paid' ? 'paid' : r.outcome === 'slashed' ? 'slashed' : ''}`}>
              {r.outcome}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

export default function UserMessage({ msg, liveLogs }: { msg: Message; liveLogs?: string[] }) {
  if (msg.sender === 'user') {
    return (
      <div className="uv-msg-row user">
        <div className="uv-bubble-user">{msg.text}</div>
      </div>
    );
  }

  if (msg.sender === 'system') {
    return (
      <div className="uv-msg-row system">
        <div className="uv-error-banner">
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <div dangerouslySetInnerHTML={{ __html: msg.html ?? msg.text ?? '' }} />
        </div>
      </div>
    );
  }

  // agent
  return (
    <div className="uv-msg-row agent">
      <div className="uv-card">
        <div className="uv-card-head">
          <span className="uv-router-avatar" />
          <span className="uv-router-name">Router</span>
        </div>
        <div className="uv-card-body">
          {msg.isThinking ? (
            <div>
              <div className="uv-thinking">
                <span className="uv-thinking-dots"><span /><span /><span /></span>
                Working on it…
              </div>
              {liveLogs && liveLogs.length > 0 && (
                <div className="uv-thinking-live">
                  {liveLogs.map((log, i) => <div key={i}>{log}</div>)}
                </div>
              )}
            </div>
          ) : msg.raw ? (
            <>
              <CollapsibleTrace steps={msg.steps ?? []} />
              {msg.raw.error && (
                <div className="uv-error-banner">
                  <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                  <div>
                    {msg.raw.error}
                    {msg.raw.zeroSpend && <div style={{ marginTop: 4, opacity: 0.8 }}>Nothing was spent.</div>}
                  </div>
                </div>
              )}
              {msg.raw.result && (
                <div className="uv-answer">
                  {buildAnswerSections(msg.raw.result).map((section) => (
                    <div key={section.agent} className="uv-answer-section">
                      <h4>{section.title}</h4>
                      <div dangerouslySetInnerHTML={{ __html: section.bodyHtml }} />
                    </div>
                  ))}
                </div>
              )}
              <CostTable msg={msg} />
            </>
          ) : (
            // Fallback for messages loaded from history (no structured `raw`, only pre-rendered html).
            <div className="uv-answer" dangerouslySetInnerHTML={{ __html: msg.html ?? msg.text ?? '' }} />
          )}
        </div>
      </div>
    </div>
  );
}
