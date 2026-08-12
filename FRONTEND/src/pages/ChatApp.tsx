import { useState, useEffect, useRef } from 'react';
import { Play, Mic, MicOff, HelpCircle, LogOut, Menu, Plus, MessageSquare } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import '../index.css';

type Message = {
  id: string;
  sender: 'user' | 'agent' | 'system';
  text?: string;
  html?: string;
  isThinking?: boolean;
};

type Balance = { name: string; address: string; algo: number; usdc: number };
type Agent = { name: string; url: string; description: string };
type QualityGateMode = 'auto' | 'pass' | 'fail';
type Session = { chatId: string; title: string; updatedAt: string };

export default function ChatApp() {
  const navigate = useNavigate();
  const { username } = useParams();
  
  const [sessions, setSessions] = useState<Session[]>([]);
  const [chatId, setChatId] = useState<string>(Date.now().toString());
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  
  const initialGreeting = {
    id: '1',
    sender: 'agent' as const,
    html: `
      <div>Hello! I am the <strong>Atomic Multi-Agent Service Router</strong>.</div>
      <div style="color:var(--text-muted);font-size:13px;margin-top:4px;">N quotes, one group, one atomic commitment — Algorand TestNet</div>
      <div style="margin-top:12px;">Give me a task, and I'll route it to specialized agents, settle their payments atomically, and return the combined result.</div>
    `
  };
  const [messages, setMessages] = useState<Message[]>([initialGreeting]);
  const [input, setInput] = useState('Summarize algorand x402 atomic groups for a hackathon judge');
  const [maxSpend, setMaxSpend] = useState<number>(0.10);
  
  const [balances, setBalances] = useState<Balance[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [qualityMode, setQualityMode] = useState<QualityGateMode>('auto');
  
  const [agentStatus, setAgentStatus] = useState<Record<string, 'alive'|'killed'>>({});
  
  const [replayAgent, setReplayAgent] = useState<string>('');
  const [replayN, setReplayN] = useState<number>(5);
  const [replayResult, setReplayResult] = useState<string>('');

  const [currentPhase, setCurrentPhase] = useState<'IDLE'|'QUALITY'|'QUOTE'|'SETTLE'|'REDEEM'|'REDEEMED'|'ERROR'>('IDLE');
  
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [processingLogs, setProcessingLogs] = useState<string[]>([]);
  
  const recognitionRef = useRef<any>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const wsRef = useRef<WebSocket | null>(null);

  // Auto-scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, processingLogs]);

  // Initial loads and WS connect
  useEffect(() => {
    fetchAgents();
    fetchQualityMode();
    fetchBalances();
    
    if (username) {
      loadSessions(username);
      connectWebSocket(username);
    }
    
    const interval = setInterval(fetchBalances, 3000);
    return () => {
      clearInterval(interval);
      if (wsRef.current) wsRef.current.close();
    };
  }, [username]);

  const connectWebSocket = (user: string) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/${user}`;
    const ws = new WebSocket(wsUrl);
    
    ws.onopen = () => console.log('WS Connected');
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'progress' && data.message) {
          setProcessingLogs(prev => [...prev, data.message]);
        }
      } catch (err) {}
    };
    ws.onclose = () => console.log('WS Disconnected');
    wsRef.current = ws;
  };

  const loadSessions = async (user: string) => {
    try {
      const res = await fetch(`/history/sessions/${user}`);
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || []);
        if (data.sessions && data.sessions.length > 0) {
          const latestId = data.sessions[0].chatId;
          setChatId(latestId);
          loadHistory(user, latestId);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const loadHistory = async (user: string, cId: string) => {
    try {
      const res = await fetch(`/history/chat/${user}/${cId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.history && data.history.length > 0) {
          const loadedMessages = data.history.map((hMsg: any) => {
            let html = '';
            hMsg.sections.forEach((sec: any) => {
              if (sec.type === 'text') {
                // simple markdown-ish parsing for bold and bullet points
                let text = sec.content
                  .replace(/\n/g, '<br/>')
                  .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                  .replace(/- (.*?)<br\/>/g, '<li>$1</li>');
                html += `<div>${text}</div>`;
              } else if (sec.type === 'process') {
                html += `<div class="receipt-box" style="margin-bottom:12px;">
                  <h4 style="color:var(--text-muted);margin-bottom:8px;font-size:12px;text-transform:uppercase;">Process Trace</h4>`;
                sec.events.forEach((evt: any) => {
                  html += `<div style="font-size:11px;color:var(--success);">✓ ${evt.description}</div>`;
                });
                html += `</div>`;
              } else if (sec.type === 'chat-element' && sec.element === 'hr') {
                html += `<hr style="border-color: rgba(255,255,255,0.1); margin: 12px 0;" />`;
              }
            });
            return {
              id: Date.now().toString() + Math.random(),
              sender: hMsg.sender,
              html
            };
          });
          setMessages([initialGreeting, ...loadedMessages]);
        } else {
          setMessages([initialGreeting]);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchBalances = async () => {
    try {
      const res = await fetch('/balances');
      if (res.ok) {
        const data = await res.json();
        setBalances(data.balances || []);
      }
    } catch (e) {
      // silent
    }
  };

  const fetchAgents = async () => {
    try {
      const res = await fetch('/agents');
      if (res.ok) {
        const data = await res.json();
        setAgents(data.agents || []);
        if (data.agents?.length > 0) {
          setReplayAgent(data.agents[0].name);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchQualityMode = async () => {
    try {
      const res = await fetch('/admin/quality-gate');
      if (res.ok) {
        const data = await res.json();
        setQualityMode(data.qualityGateMode || 'auto');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const toggleAgentKill = async (name: string, kill: boolean) => {
    await fetch(`/admin/${kill ? 'kill' : 'revive'}/${name}`, { method: 'POST' });
    setAgentStatus(prev => ({ ...prev, [name]: kill ? 'killed' : 'alive' }));
  };

  const changeQualityMode = async (mode: QualityGateMode) => {
    await fetch(`/admin/quality-gate/${mode}`, { method: 'POST' });
    setQualityMode(mode);
  };

  const runReplayTest = async () => {
    setReplayResult('Running...');
    try {
      const res = await fetch('/self-test/replay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: replayAgent, n: replayN }),
      });
      const data = await res.json();
      if (!res.ok) {
        setReplayResult(`<span style="color: var(--danger);">${data.error || 'failed'}</span>`);
        return;
      }
      setReplayResult(
        `<span style="color: var(--success); font-weight:600;">${data.passedGuard} passed the guard</span> / ` +
        `<span style="color: var(--danger); font-weight:600;">${data.replayRejected} rejected as replay (409)</span> ` +
        `out of ${data.attempts} attempts.`
      );
    } catch (e: any) {
      setReplayResult(`<span style="color: var(--danger);">${e.message || String(e)}</span>`);
    }
  };

  const addMessage = (msg: Omit<Message, 'id'>) => {
    setMessages(prev => [...prev, { ...msg, id: Date.now().toString() + Math.random() }]);
  };

  const handleSend = () => {
    if (!input.trim()) return;
    
    // User message
    addMessage({ sender: 'user', text: input.trim() });
    setProcessingLogs([]);
    
    // Agent response asking for budget
    setTimeout(() => {
      addMessage({
        sender: 'agent',
        html: `
          <div style="margin-bottom:12px;">I will route this task. Do you want to run a live payment route (max spend $${maxSpend.toFixed(2)}) or a free preview?</div>
          <button class="btn primary" id="approve-btn" style="margin-right:8px; margin-bottom:8px;" onclick="window.dispatchEvent(new CustomEvent('execute-route', {detail: {task: '${input.replace(/'/g, "\\'")}', maxSpend: ${maxSpend}}}))">
            Route (Max $${maxSpend.toFixed(2)})
          </button>
          <button class="btn" style="margin-right:8px; margin-bottom:8px; background: rgba(255,255,255,0.1);" onclick="window.dispatchEvent(new CustomEvent('execute-preview', {detail: '${input.replace(/'/g, "\\'")}'}))">
            Preview (no payment)
          </button>
          <button class="btn danger" style="margin-bottom:8px;" onclick="window.dispatchEvent(new Event('cancel-task'))">Cancel</button>
        `
      });
      setInput('');
    }, 600);
  };

  useEffect(() => {
    const handleRoute = (e: any) => {
      const { task, maxSpend } = e.detail;
      executeRoute(task, maxSpend);
    };
    const handlePreview = (e: any) => {
      const task = e.detail;
      executePreview(task);
    };
    const handleCancel = () => {
      addMessage({ sender: 'system', text: 'Task cancelled.' });
      setCurrentPhase('IDLE');
    };

    window.addEventListener('execute-route', handleRoute);
    window.addEventListener('execute-preview', handlePreview);
    window.addEventListener('cancel-task', handleCancel);
    return () => {
      window.removeEventListener('execute-route', handleRoute);
      window.removeEventListener('execute-preview', handlePreview);
      window.removeEventListener('cancel-task', handleCancel);
    };
  }, []);

  const executePreview = async (task: string) => {
    setCurrentPhase('IDLE');
    const thinkingId = Date.now().toString();
    setMessages(prev => [...prev, { id: thinkingId, sender: 'agent', isThinking: true }]);
    
    try {
      const res = await fetch('/debug/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task })
      });
      const data = await res.json();
      setMessages(prev => prev.filter(m => m.id !== thinkingId));

      if (!res.ok) {
        addMessage({ sender: 'system', html: `<div class="badge danger">Preview Failed: ${data.error}</div>` });
        return;
      }

      let resultHtml = `<div class="badge success" style="margin-bottom:12px;">Preview only — no payment, no atomic group</div>`;
      if (data.result) {
        Object.entries(data.result).forEach(([agent, output]: [string, any]) => {
          let content = '';
          if (Array.isArray(output.findings)) {
            content = `<pre>${output.findings.map((f:any) => '- ' + (f.point ?? JSON.stringify(f))).join('\\n')}</pre>`;
          } else if (output.summary?.body) {
            content = `<pre>${output.summary.body}</pre>`;
          } else if (typeof output.svg === 'string') {
            content = `<div style="background:#fff;padding:10px;border-radius:8px;">${output.svg}</div>`;
          } else {
            content = `<pre>${JSON.stringify(output, null, 2)}</pre>`;
          }
          resultHtml += `<div class="agent-block"><h4>${agent}</h4>${content}</div>`;
        });
      }
      addMessage({ sender: 'agent', html: resultHtml });
    } catch (e: any) {
      setMessages(prev => prev.filter(m => m.id !== thinkingId));
      addMessage({ sender: 'system', html: `<div class="badge danger">Error: ${e.message}</div>` });
    }
  };

  const executeRoute = async (task: string, maxSpend: number) => {
    setCurrentPhase('QUALITY');
    setProcessingLogs(['Starting task routing...', 'Checking quality gates...']);
    const thinkingId = Date.now().toString();
    setMessages(prev => [...prev, { id: thinkingId, sender: 'agent', isThinking: true }]);

    try {
      const res = await fetch('/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, maxSpend, username, chatId })
      });
      
      const data = await res.json();
      setMessages(prev => prev.filter(m => m.id !== thinkingId));

      // the backend WS handles the logs, but we keep this just in case backend falls back to HTTP phases
      if (data.phase && data.phase !== currentPhase) {
        setCurrentPhase(data.phase as any);
      } else if (data.error) {
        setCurrentPhase('ERROR');
      }

      let resultHtml = '';

      if (data.error) {
        resultHtml += `
          <div class="receipt-box" style="margin-bottom:12px; border-color: var(--danger); background: rgba(239, 68, 68, 0.05);">
            <h4 style="color:var(--danger);margin-bottom:8px;">❌ Process Failed</h4>
            <div style="font-size:13px; color:var(--text-muted);">
              These processes failed: <strong style="color:var(--danger);">${data.error}</strong><br/>
              The process could not be completed.
            </div>
            ${data.zeroSpend ? '<span class="badge warning" style="margin-top:8px; display:inline-block;">ZERO SPEND</span>' : ''}
          </div>
        `;
      }

      if (data.qualityVerdicts && data.qualityVerdicts.length > 0) {
        setProcessingLogs(prev => [...prev, `Quality gates passed for ${data.qualityVerdicts.filter((v:any) => v.ok).length} agents`]);
        resultHtml += `
          <div class="receipt-box" style="margin-bottom:12px;">
            <h4 style="color:var(--text-muted);margin-bottom:8px;font-size:12px;text-transform:uppercase;">Quality Gate Results</h4>
            ${data.qualityVerdicts.map((v: any) => `
              <div class="receipt-row">
                <span>${v.agent}</span>
                <span class="badge ${v.ok ? 'success' : 'danger'}">${v.ok ? 'PASS' : 'FAIL'}</span>
                <span style="font-size:11px;color:var(--text-muted);">${v.reason || ''}</span>
              </div>
            `).join('')}
          </div>
        `;
      }

      if (data.settlement) {
        setProcessingLogs(prev => [...prev, `Settlement successful. Group ID: ${data.settlement.groupId.substring(0, 8)}...`]);
        resultHtml += `
          <div class="receipt-box" style="margin-bottom:12px;">
            <h4 style="color:var(--text-accent);margin-bottom:8px;">Settlement Success</h4>
            <div class="receipt-row">
              <span class="receipt-label">Group ID</span>
              <a href="${data.settlement.explorerUrl}" target="_blank" rel="noreferrer" class="group-link" style="font-size:11px;">${data.settlement.groupId}</a>
            </div>
            <div class="receipt-row">
              <span class="receipt-label">Confirmed Round</span>
              <span>${data.settlement.confirmedRound}</span>
            </div>
          </div>
        `;
      }

      if (data.receipt && data.receipt.length > 0) {
         resultHtml += `<div class="receipt-box" style="margin-bottom:12px;">
            <h4 style="color:var(--text-accent);margin-bottom:8px;">Receipt (who got paid/slashed)</h4>
            ${data.receipt.map((r: any) => `
              <div class="receipt-row">
                <span>${r.agent}</span>
                <span>$${r.amountUsd.toFixed(2)} <span class="badge ${r.outcome === 'paid' ? 'success' : 'danger'}">${r.outcome}</span></span>
              </div>
            `).join('')}
         </div>`;
      }

      if (data.result) {
        resultHtml += `<h4 style="margin-top:16px;margin-bottom:8px;color:var(--success);">Agent Results:</h4>`;
        Object.entries(data.result).forEach(([agent, output]: [string, any]) => {
          let content = '';
          if (Array.isArray(output.findings)) {
            content = `<pre>${output.findings.map((f:any) => '- ' + (f.point ?? JSON.stringify(f))).join('\\n')}</pre>`;
          } else if (output.summary?.body) {
            content = `<pre>${output.summary.body}</pre>`;
          } else if (typeof output.svg === 'string') {
            content = `<div style="background:#fff;padding:10px;border-radius:8px;">${output.svg}</div>`;
          } else {
            content = `<pre>${JSON.stringify(output, null, 2)}</pre>`;
          }
          resultHtml += `<div class="agent-block"><h4>${agent}</h4>${content}</div>`;
        });
      }

      if (data.result && !data.error) {
        resultHtml += `
          <div class="receipt-box" style="margin-top:12px; border-color: var(--success); background: rgba(34, 197, 94, 0.05);">
            <h4 style="color:var(--success);margin-bottom:0;">✅ All processes executed successfully</h4>
          </div>
        `;
      }

      addMessage({ sender: 'agent', html: resultHtml });

      if (username) {
        loadSessions(username);
      }
    } catch (err: any) {
      setMessages(prev => prev.filter(m => m.id !== thinkingId));
      setCurrentPhase('ERROR');
      addMessage({ sender: 'system', html: `<div class="badge danger">Failed to connect to router: ${err.message || String(err)}</div>` });
    }
  };

  const toggleListening = () => {
    if (isListening) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsListening(false);
      setInterimTranscript('');
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Voice recognition is not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => {
      setIsListening(false);
      setInterimTranscript('');
    };
    recognition.onerror = (e: any) => {
      console.error(e);
      setIsListening(false);
      setInterimTranscript('');
    };
    recognition.onresult = (e: any) => {
      let interim = '';
      let finalStr = '';
      for (let i = e.resultIndex; i < e.results.length; ++i) {
        if (e.results[i].isFinal) {
          finalStr += e.results[i][0].transcript;
        } else {
          interim += e.results[i][0].transcript;
        }
      }
      
      if (finalStr) {
        setInput(prev => prev + (prev && !prev.endsWith(' ') ? ' ' : '') + finalStr);
      }
      setInterimTranscript(interim);
    };

    setIsListening(true);
    recognition.start();
  };

  const handleLogout = () => {
    localStorage.removeItem('session_user');
    navigate('/');
  };

  const startNewChat = () => {
    setChatId(Date.now().toString());
    setMessages([initialGreeting]);
    setIsSidebarOpen(false);
  };

  const switchSession = (cId: string) => {
    setChatId(cId);
    if (username) loadHistory(username, cId);
    setIsSidebarOpen(false);
  };

  return (
    <div className="app-container" style={{ display: 'flex', position: 'relative' }}>
      
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
            <button className="btn" onClick={() => navigate('/tutorial')} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <HelpCircle size={16} /> Help
            </button>
            <button className="btn" onClick={handleLogout} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', borderColor: 'var(--danger)' }}>
              <LogOut size={16} /> Logout
            </button>
          </div>
        </div>
        
        {/* Big Phase Tracker - as requested by UI screenshots */}
        <div className="panel" style={{marginBottom: '20px'}}>
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

        <div className="input-area">
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
                   if (e.key === 'Enter') handleSend();
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
             <button className="btn primary" onClick={handleSend} disabled={!input.trim()}>
               <Play size={14} style={{marginRight: '6px', display:'inline-block', verticalAlign:'middle'}}/>
               Route
             </button>
             <button className="btn" style={{background: 'rgba(255,255,255,0.05)'}} onClick={() => executePreview(input.trim())} disabled={!input.trim()}>
               Preview (no payment)
             </button>
          </div>
        </div>
      </div>

      {/* Right Sidebar */}
      <div className="glass-panel sidebar">
        
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
