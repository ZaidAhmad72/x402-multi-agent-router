import { Play, Mic, MicOff, HelpCircle, LogOut, Menu, Plus, MessageSquare, Sparkles } from 'lucide-react';
import type { RefObject } from 'react';
import type { Agent, Balance, Message, QualityGateMode, Reputation, Session } from '../../types';

export interface DevViewProps {
  username?: string;
  isSidebarOpen: boolean;
  setIsSidebarOpen: (open: boolean) => void;
  sessions: Session[];
  chatId: string;
  switchSession: (chatId: string) => void;
  startNewChat: () => void;

  messages: Message[];
  processingLogs: string[];
  messagesEndRef: RefObject<HTMLDivElement | null>;

  input: string;
  setInput: (value: string) => void;
  isListening: boolean;
  interimTranscript: string;
  toggleListening: () => void;
  handleRouteClick: () => void;
  handlePreviewClick: () => void;

  maxSpend: number;
  setMaxSpend: (value: number) => void;

  currentPhase: 'IDLE' | 'QUALITY' | 'QUOTE' | 'SETTLE' | 'REDEEM' | 'REDEEMED' | 'ERROR';

  balances: Balance[];
  reputation: Reputation | null;

  agents: Agent[];
  agentStatus: Record<string, 'alive' | 'killed'>;
  toggleAgentKill: (name: string, kill: boolean) => void;

  qualityMode: QualityGateMode;
  changeQualityMode: (mode: QualityGateMode) => void;

  replayAgent: string;
  setReplayAgent: (name: string) => void;
  replayN: number;
  setReplayN: (n: number) => void;
  replayResult: string;
  runReplayTest: () => void;

  onHelp: () => void;
  onLogout: () => void;
  onSwitchToUserView: () => void;
}

/**
 * The original demo/debug UI — every internal knob (kill switch, quality
 * gate override, replay self-test) left visible. Kept as its own component,
 * unchanged in behavior from before the user-view split, so judges/devs
 * still get the full instrumented surface; ChatApp.tsx just decides which
 * of DevView/UserView to mount.
 */
export default function DevView(props: DevViewProps) {
  const {
    username, isSidebarOpen, setIsSidebarOpen, sessions, chatId, switchSession, startNewChat,
    messages, processingLogs, messagesEndRef,
    input, setInput, isListening, interimTranscript, toggleListening, handleRouteClick, handlePreviewClick,
    maxSpend, setMaxSpend, currentPhase, balances, reputation,
    agents, agentStatus, toggleAgentKill,
    qualityMode, changeQualityMode,
    replayAgent, setReplayAgent, replayN, setReplayN, replayResult, runReplayTest,
    onHelp, onLogout, onSwitchToUserView,
  } = props;

  return (
    <div className="app-container" style={{ position: 'relative' }}>

      {/* Sidebar Overlay */}
      {isSidebarOpen && (
        <div style={{
          position: 'absolute', top: 0, left: 0, bottom: 0, width: '260px',
          background: 'var(--panel-bg)', zIndex: 100, borderRight: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', padding: '16px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h2 style={{ fontSize: '14px', margin: 0 }}>Chat History</h2>
            <button className="btn" onClick={() => setIsSidebarOpen(false)} style={{ padding: '4px' }}>✗</button>
          </div>

          <button className="btn primary" onClick={startNewChat} style={{ marginBottom: '16px', display: 'flex', justifyContent: 'center', gap: '8px' }}>
            <Plus size={16} /> New Chat
          </button>

          <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {sessions.map(s => (
              <div
                key={s.chatId}
                onClick={() => switchSession(s.chatId)}
                style={{
                  padding: '10px',
                  background: s.chatId === chatId ? 'rgba(255,255,255,0.1)' : 'transparent',
                  borderRadius: '6px', cursor: 'pointer', fontSize: '13px',
                  display: 'flex', alignItems: 'center', gap: '8px',
                  border: s.chatId === chatId ? '1px solid var(--text-accent)' : '1px solid transparent'
                }}>
                <MessageSquare size={14} style={{ opacity: 0.7 }} />
                <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.title}</div>
              </div>
            ))}
          </div>

          {reputation && (
            <div
              title={reputation.category.description}
              style={{
                marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--panel-border)',
                display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
              }}
            >
              <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                Reputation: <strong style={{ color: 'var(--text-main)' }}>{reputation.reputation.toFixed(1)}/10</strong>
              </span>
              <span
                className={`badge ${
                  ['excellent', 'good'].includes(reputation.category.label.toLowerCase())
                    ? 'success'
                    : reputation.category.label.toLowerCase() === 'fair'
                    ? 'warning'
                    : 'danger'
                }`}
              >
                {reputation.category.label}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Left Chat Window */}
      <div className="glass-panel chat-container" style={{ flex: 1, position: 'relative' }}>
        <div className="chat-header" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button className="btn" onClick={() => setIsSidebarOpen(true)} style={{ padding: '8px', background: 'transparent', border: 'none' }}>
            <Menu size={24} />
          </button>
          <div className="title">
            <h1 style={{ fontSize: '16px', margin: 0 }}>Atomic Multi-Agent Service Router</h1>
            <p style={{ margin: 0 }}>Welcome, {username || 'User'}!</p>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
            <button
              className="btn"
              onClick={onSwitchToUserView}
              title="Switch to the clean, user-facing chat view"
              style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(139, 92, 246, 0.12)', color: 'var(--primary)', borderColor: 'rgba(139, 92, 246, 0.4)' }}
            >
              <Sparkles size={16} /> User View
            </button>
            <button className="btn" onClick={onHelp} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(139, 92, 246, 0.15)', color: '#c084fc', borderColor: 'rgba(139, 92, 246, 0.4)' }}>
              <HelpCircle size={16} /> Tutorial
            </button>
            <button className="btn" onClick={onLogout} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', borderColor: 'var(--danger)' }}>
              <LogOut size={16} /> Logout
            </button>
          </div>
        </div>

        <div className="input-area" style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', gap: '12px', marginBottom: '8px' }}>
             <div style={{ flex: 1, position: 'relative' }}>
               <label style={{fontSize:'12px', color:'var(--text-muted)', display:'block', marginBottom:'4px'}}>Task</label>
               {isListening && (
                 <div style={{
                   position: 'absolute',
                   top: '-24px',
                   right: '12px',
                   background: 'rgba(0, 0, 0, 0.8)',
                   border: '1px solid var(--primary)',
                   padding: '4px 10px',
                   borderRadius: '12px',
                   display: 'flex',
                   alignItems: 'center',
                   gap: '8px',
                   color: 'var(--primary)',
                   fontSize: '11px',
                   fontWeight: 600,
                   boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                   zIndex: 10
                 }}>
                   Listening
                   <div className="sound-waves">
                     <div className="wave"></div>
                     <div className="wave"></div>
                     <div className="wave"></div>
                     <div className="wave"></div>
                   </div>
                 </div>
               )}
               <input
                 type="text"
                 className="custom-input"
                 value={input + (interimTranscript ? (input && !input.endsWith(' ') ? ' ' : '') + interimTranscript : '')}
                 onChange={e => setInput(e.target.value)}
                 onKeyDown={e => {
                   if (e.key === 'Enter') handleRouteClick();
                 }}
                 style={{ paddingRight: '40px' }}
               />
               <button
                 type="button"
                 onClick={toggleListening}
                 style={{
                   position: 'absolute',
                   right: '8px',
                   top: '24px',
                   background: 'none',
                   border: 'none',
                   color: isListening ? 'var(--danger)' : 'var(--text-muted)',
                   cursor: 'pointer'
                 }}
                 title="Voice to text"
               >
                 {isListening ? <MicOff size={18} /> : <Mic size={18} />}
               </button>
             </div>
             <div style={{ width: '120px' }}>
               <label style={{fontSize:'12px', color:'var(--text-muted)', display:'block', marginBottom:'4px'}}>Max Spend (USD)</label>
               <input
                 type="number"
                 step="0.01"
                 className="custom-input"
                 value={maxSpend}
                 onChange={e => setMaxSpend(parseFloat(e.target.value))}
               />
             </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
             <button className="btn primary" onClick={handleRouteClick} disabled={!input.trim()}>
               <Play size={14} style={{marginRight: '6px', display:'inline-block', verticalAlign:'middle'}}/>
               Route
             </button>
             <button className="btn" style={{background: 'rgba(255,255,255,0.05)'}} onClick={handlePreviewClick} disabled={!input.trim()}>
               Preview (no payment)
             </button>
          </div>
        </div>

        <div className="messages-area">
          {messages.map(msg => (
            <div key={msg.id} className={`message-bubble ${msg.sender}`}>
              {msg.isThinking ? (
                <div className="typing-indicator">
                  <div className="typing-dot"></div><div className="typing-dot"></div><div className="typing-dot"></div>
                </div>
              ) : msg.html ? (
                <div dangerouslySetInnerHTML={{ __html: msg.html }} />
              ) : (
                msg.text
              )}
            </div>
          ))}
          {processingLogs.length > 0 && (
            <div className="processing-logs">
              <h4 style={{fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '4px'}}>Live Tasks</h4>
              {processingLogs.map((log, idx) => {
                const isError = log.includes('Error:');
                const isSuccess = log.includes('Success:');
                return (
                  <div key={idx} className="log-item" style={{
                    fontSize: '12px',
                    color: isError ? 'var(--danger)' : (isSuccess ? 'var(--success)' : 'var(--text-muted)'),
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    marginBottom: '4px'
                  }}>
                    {isError ? (
                      <span style={{fontWeight:'bold', color:'var(--danger)', fontSize:'14px'}}>✗</span>
                    ) : isSuccess ? (
                      <span style={{fontWeight:'bold', color:'var(--success)', fontSize:'14px'}}>✓</span>
                    ) : (
                      <div className="typing-dot" style={{animationDelay: '0s'}}></div>
                    )}
                    {log}
                  </div>
                );
              })}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Right Sidebar */}
      <div className="glass-panel sidebar">

        {/* Big Phase Tracker */}
        <div className="panel" style={{marginBottom: '0'}}>
          <h3 style={{fontSize:'12px', color:'var(--text-muted)', marginBottom:'12px', textTransform:'uppercase'}}>Phase</h3>
          <div className="phases-big">
            <div className={`phase-big-step ${currentPhase === 'QUALITY' ? 'active' : (['QUOTE','SETTLE','REDEEMED'].includes(currentPhase) ? 'done' : '')}`}>
              <div className="num">1</div>QUALITY
            </div>
            <div className={`phase-big-step ${currentPhase === 'QUOTE' ? 'active' : (['SETTLE','REDEEMED'].includes(currentPhase) ? 'done' : '')}`}>
              <div className="num">2</div>QUOTE
            </div>
            <div className={`phase-big-step ${currentPhase === 'SETTLE' ? 'active' : (currentPhase === 'REDEEMED' ? 'done' : '')}`}>
              <div className="num">3</div>SETTLE
            </div>
            <div className={`phase-big-step ${currentPhase === 'REDEEMED' ? 'done' : ''}`}>
              <div className="num">4</div>REDEEM
            </div>
          </div>
        </div>

        {/* Balances */}
        <div className="panel">
          <h3>AGENT WALLET BALANCES <span style={{textTransform:'none', fontWeight:'normal', color:'var(--text-muted)'}}>(FEE ABSTRACTION — AGENTS NEVER SIGN A FEE-BEARING TXN)</span></h3>
          <table className="custom-table">
            <thead>
              <tr>
                <th>WALLET</th>
                <th>ADDRESS</th>
                <th>ALGO</th>
                <th>USDC</th>
              </tr>
            </thead>
            <tbody>
              {balances.map(b => (
                <tr key={b.name}>
                  <td>{b.name}</td>
                  <td style={{fontFamily:'monospace', color:'var(--text-muted)'}}>{b.address ? b.address.substring(0,6) + '...' : '—'}</td>
                  <td>{b.algo.toFixed(3)}</td>
                  <td>{b.usdc.toFixed(2)}</td>
                </tr>
              ))}
              {balances.length === 0 && <tr><td colSpan={4} style={{color:'var(--text-muted)'}}>Loading...</td></tr>}
            </tbody>
          </table>
        </div>

        {/* Kill Switch */}
        <div className="panel">
          <h3>DEMO KILL SWITCH <span style={{textTransform:'none', fontWeight:'normal', color:'var(--text-muted)'}}>(KILLS AN AGENT SO QUOTE FAILS BEFORE ANY MONEY MOVES)</span></h3>
          {agents.map(agent => {
             const status = agentStatus[agent.name] || 'alive';
             return (
              <div key={agent.name} style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', fontSize: '13px' }}>
                <span style={{width:'90px'}}>{agent.name}</span>
                <button className="btn danger" style={{ padding: '4px 8px', marginRight: '6px', fontSize:'11px' }} onClick={() => toggleAgentKill(agent.name, true)}>Kill</button>
                <button className="btn success-btn" style={{ padding: '4px 8px', marginRight: '8px', fontSize:'11px' }} onClick={() => toggleAgentKill(agent.name, false)}>Revive</button>
                <span style={{color:'var(--text-muted)', fontSize:'12px'}}>{status}</span>
              </div>
            )
          })}
        </div>

        {/* Quality Gate */}
        <div className="panel">
          <h3>DEMO QUALITY GATE OVERRIDE <span style={{textTransform:'none', fontWeight:'normal', color:'var(--text-muted)'}}>(FORCES THE PRE-PAYMENT QUALITY CHECK'S OUTCOME, FOR TESTING "BAD ANSWER -{'>'} NO PAYMENT")</span></h3>
          <div style={{ display: 'flex', gap: '8px', alignItems:'center' }}>
            <button
              className={`btn ${qualityMode === 'auto' ? 'primary' : ''}`}
              style={{ fontSize:'12px', padding:'6px 12px' }}
              onClick={() => changeQualityMode('auto')}
            >Auto (real judge)</button>
            <button
              className={`btn ${qualityMode === 'fail' ? 'danger' : ''}`}
              style={{ fontSize:'12px', padding:'6px 12px' }}
              onClick={() => changeQualityMode('fail')}
            >Force fail</button>
            <button
              className={`btn ${qualityMode === 'pass' ? 'success-btn' : ''}`}
              style={{ fontSize:'12px', padding:'6px 12px' }}
              onClick={() => changeQualityMode('pass')}
            >Force pass</button>
            <span style={{color:'var(--text-muted)', fontSize:'12px', marginLeft:'4px'}}>{qualityMode}</span>
          </div>
        </div>

        {/* Replay Guard */}
        <div className="panel">
          <h3>SELF-TEST: REPLAY GUARD <span style={{textTransform:'none', fontWeight:'normal', color:'var(--text-muted)'}}>(FIRES N CONCURRENT REDEEM ATTEMPTS WITH THE SAME PROOF — PROVES EXACTLY ONE GETS THROUGH)</span></h3>
          <div style={{ display: 'flex', gap: '8px', alignItems:'center', marginBottom: '8px' }}>
            <select className="custom-input" style={{width:'auto'}} value={replayAgent} onChange={e => setReplayAgent(e.target.value)}>
              {agents.map(a => <option key={a.name} value={a.name}>{a.name}</option>)}
            </select>
            <input type="number" className="custom-input" style={{width:'60px'}} value={replayN} onChange={e => setReplayN(parseInt(e.target.value))} />
            <button className="btn" style={{ fontSize:'12px', padding:'6px 12px', background:'rgba(255,255,255,0.1)' }} onClick={runReplayTest}>
              Run replay test
            </button>
          </div>
          {replayResult && (
            <div style={{fontSize:'12px', padding:'8px', background:'rgba(0,0,0,0.2)', borderRadius:'6px'}} dangerouslySetInnerHTML={{__html: replayResult}} />
          )}
        </div>

      </div>
    </div>
  );
}
