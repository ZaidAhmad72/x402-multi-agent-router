import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import '../index.css';
import type { Agent, Balance, Message, Phase, QualityGateMode, Session } from '../types';
import { buildRouteSteps } from '../lib/answer';
import DevView from '../components/dev-view/DevView';
import UserView from '../components/user-view/UserView';

export default function ChatApp() {
  const navigate = useNavigate();
  const { username } = useParams();

  const [viewMode, setViewMode] = useState<'dev' | 'user'>('dev');

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

  const [currentPhase, setCurrentPhase] = useState<Phase>('IDLE');

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

  // Frontend-driven history sync
  useEffect(() => {
    if (!username || !chatId) return;
    if (messages.length <= 1) return; // Don't sync just the initial greeting

    const firstUserMsg = messages.find(m => m.sender === 'user');
    let title = 'New Chat';
    if (firstUserMsg && firstUserMsg.html) {
      // Very simple strip of html tags to get text for the title
      title = firstUserMsg.html.replace(/<[^>]*>?/gm, '').substring(0, 50);
    } else if (firstUserMsg && firstUserMsg.text) {
      title = firstUserMsg.text.substring(0, 50);
    }

    fetch('/history/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        chatId,
        title,
        messages
      })
    }).catch(console.error);
  }, [messages, chatId, username]);

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

  // Route/Preview used to ask for confirmation in a second chat message
  // ("Do you want to run a live payment route... or a free preview?") with
  // its own Route/Preview/Cancel buttons -- meaning clicking Route in the
  // input box didn't actually route anything, it just asked the same
  // question again. These now execute directly on click; the task the user
  // typed still shows up as their own chat message first, so there's no
  // loss of "what did I just ask for" context, just no redundant second click.
  const handleRouteClick = () => {
    if (!input.trim()) return;
    const task = input.trim();
    addMessage({ sender: 'user', text: task });
    setProcessingLogs([]);
    setInput('');
    executeRoute(task, maxSpend);
  };

  const handlePreviewClick = () => {
    if (!input.trim()) return;
    const task = input.trim();
    addMessage({ sender: 'user', text: task });
    setProcessingLogs([]);
    setInput('');
    executePreview(task);
  };

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
      const steps = buildRouteSteps(data, [], true);
      setProcessingLogs([]);
      addMessage({ sender: 'agent', html: resultHtml, raw: data, steps, isPreview: true });
    } catch (e: any) {
      setProcessingLogs([]);
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
        setProcessingLogs(prev => [...prev, `Error: ${data.error}`]);
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

      const steps = buildRouteSteps(data, processingLogs, false);
      setProcessingLogs([]);
      addMessage({ sender: 'agent', html: resultHtml, raw: data, steps });

      if (username) {
        loadSessions(username);
      }
    } catch (err: any) {
      const errMsg = err.message || String(err);
      setMessages(prev => prev.filter(m => m.id !== thinkingId));
      setCurrentPhase('ERROR');
      setProcessingLogs([]);
      addMessage({ sender: 'system', html: `<div class="badge danger">Failed to connect to router: ${errMsg}</div>` });
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

  const handleHelp = () => navigate('/tutorial');

  if (viewMode === 'user') {
    return (
      <UserView
        username={username}
        sessions={sessions}
        chatId={chatId}
        switchSession={switchSession}
        startNewChat={startNewChat}
        messages={messages}
        processingLogs={processingLogs}
        messagesEndRef={messagesEndRef}
        input={input}
        setInput={setInput}
        isListening={isListening}
        interimTranscript={interimTranscript}
        toggleListening={toggleListening}
        handleRouteClick={handleRouteClick}
        handlePreviewClick={handlePreviewClick}
        maxSpend={maxSpend}
        setMaxSpend={setMaxSpend}
        currentPhase={currentPhase}
        balances={balances}
        onHelp={handleHelp}
        onLogout={handleLogout}
        onSwitchToDevView={() => setViewMode('dev')}
      />
    );
  }

  return (
    <DevView
      username={username}
      isSidebarOpen={isSidebarOpen}
      setIsSidebarOpen={setIsSidebarOpen}
      sessions={sessions}
      chatId={chatId}
      switchSession={switchSession}
      startNewChat={startNewChat}
      messages={messages}
      processingLogs={processingLogs}
      messagesEndRef={messagesEndRef}
      input={input}
      setInput={setInput}
      isListening={isListening}
      interimTranscript={interimTranscript}
      toggleListening={toggleListening}
      handleRouteClick={handleRouteClick}
      handlePreviewClick={handlePreviewClick}
      maxSpend={maxSpend}
      setMaxSpend={setMaxSpend}
      currentPhase={currentPhase}
      balances={balances}
      agents={agents}
      agentStatus={agentStatus}
      toggleAgentKill={toggleAgentKill}
      qualityMode={qualityMode}
      changeQualityMode={changeQualityMode}
      replayAgent={replayAgent}
      setReplayAgent={setReplayAgent}
      replayN={replayN}
      setReplayN={setReplayN}
      replayResult={replayResult}
      runReplayTest={runReplayTest}
      onHelp={handleHelp}
      onLogout={handleLogout}
      onSwitchToUserView={() => setViewMode('user')}
    />
  );
}
