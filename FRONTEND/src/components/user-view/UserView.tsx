import { useState, type RefObject } from 'react';
import { Menu, SlidersHorizontal } from 'lucide-react';
import './user-view.css';
import type { Balance, Message, Phase, Reputation, Session } from '../../types';
import UserSidebar from './UserSidebar';
import UserRightPanel from './UserRightPanel';
import UserMessage from './UserMessage';
import UserChatInput from './UserChatInput';

export interface UserViewProps {
  username?: string;

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

  currentPhase: Phase;
  balances: Balance[];
  reputation: Reputation | null;

  onHelp: () => void;
  onLogout: () => void;
  onSwitchToDevView: () => void;
}

/**
 * The user-facing chat UI — every internal/demo control (kill switch,
 * quality-gate override, replay self-test) intentionally left out. Only
 * what a real end user needs: chat history, the conversation itself with a
 * collapsible "what it did" trace and an agents/cost breakdown per answer,
 * and the two pieces of live system state worth showing (settlement phase,
 * wallet balances). Talks to the exact same handlers/state as DevView —
 * ChatApp.tsx owns all of that — so switching views never touches the
 * router, WebSocket connection, or history sync underneath it.
 */
export default function UserView(props: UserViewProps) {
  const {
    username, sessions, chatId, switchSession, startNewChat,
    messages, processingLogs, messagesEndRef,
    input, setInput, isListening, interimTranscript, toggleListening,
    handleRouteClick, handlePreviewClick,
    maxSpend, setMaxSpend, currentPhase, balances, reputation,
    onHelp, onLogout, onSwitchToDevView,
  } = props;

  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);

  const handleSend = () => {
    if (previewMode) handlePreviewClick();
    else handleRouteClick();
  };

  return (
    <div className="uv-shell">
      <UserSidebar
        open={leftOpen}
        onClose={() => setLeftOpen(false)}
        sessions={sessions}
        chatId={chatId}
        switchSession={switchSession}
        startNewChat={startNewChat}
        onHelp={onHelp}
        onLogout={onLogout}
        onSwitchToDevView={onSwitchToDevView}
        reputation={reputation}
      />

      <div className="uv-main">
        <div className="uv-topbar">
          <button className="uv-icon-btn menu-btn" onClick={() => setLeftOpen(true)}>
            <Menu size={18} />
          </button>
          <div style={{ flex: 1 }}>
            <div className="uv-topbar-title">Atomic Multi-Agent Service Router</div>
            <div className="uv-topbar-sub">Welcome, {username || 'there'} — ask a question below</div>
          </div>
          <button className="uv-icon-btn menu-btn" onClick={() => setRightOpen(true)}>
            <SlidersHorizontal size={16} />
          </button>
        </div>

        <div className="uv-messages">
          {messages.map((msg) => (
            <UserMessage key={msg.id} msg={msg} liveLogs={msg.isThinking ? processingLogs : undefined} />
          ))}
          <div ref={messagesEndRef} />
        </div>

        <UserChatInput
          input={input}
          setInput={setInput}
          onSend={handleSend}
          isListening={isListening}
          interimTranscript={interimTranscript}
          toggleListening={toggleListening}
          maxSpend={maxSpend}
          setMaxSpend={setMaxSpend}
          previewMode={previewMode}
          setPreviewMode={setPreviewMode}
          disabled={messages.some((m) => m.isThinking)}
        />
      </div>

      <UserRightPanel open={rightOpen} currentPhase={currentPhase} balances={balances} />
      {rightOpen && <div className="uv-scrim" onClick={() => setRightOpen(false)} />}
    </div>
  );
}
