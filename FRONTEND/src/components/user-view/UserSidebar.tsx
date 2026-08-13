import { Plus, MessageSquare, HelpCircle, LogOut, Wrench, Router } from 'lucide-react';
import type { Session } from '../../types';

export interface UserSidebarProps {
  open: boolean;
  onClose: () => void;
  sessions: Session[];
  chatId: string;
  switchSession: (chatId: string) => void;
  startNewChat: () => void;
  onHelp: () => void;
  onLogout: () => void;
  onSwitchToDevView: () => void;
}

export default function UserSidebar(props: UserSidebarProps) {
  const { open, onClose, sessions, chatId, switchSession, startNewChat, onHelp, onLogout, onSwitchToDevView } = props;

  return (
    <>
      {open && <div className="uv-scrim" onClick={onClose} />}
      <div className={`uv-sidebar ${open ? 'open' : ''}`}>
        <div className="uv-brand">
          <div className="uv-brand-dot"><Router size={16} /></div>
          <div className="uv-brand-text">
            <div className="name">Atomic Router</div>
            <div className="tag">Algorand TestNet</div>
          </div>
        </div>

        <button className="uv-new-chat" onClick={() => { startNewChat(); onClose(); }}>
          <Plus size={16} /> New chat
        </button>

        <div className="uv-session-list">
          {sessions.map((s) => (
            <div
              key={s.chatId}
              className={`uv-session ${s.chatId === chatId ? 'active' : ''}`}
              onClick={() => { switchSession(s.chatId); onClose(); }}
            >
              <MessageSquare size={14} />
              <span>{s.title}</span>
            </div>
          ))}
          {sessions.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 10px' }}>No chats yet</div>
          )}
        </div>

        <div className="uv-sidebar-footer">
          <button className="uv-footer-btn" onClick={onHelp}>
            <HelpCircle size={15} /> Help
          </button>
          <button className="uv-footer-btn exit" onClick={onSwitchToDevView}>
            <Wrench size={15} /> Developer view
          </button>
          <button className="uv-footer-btn" onClick={onLogout} style={{ color: '#fca5a5' }}>
            <LogOut size={15} /> Logout
          </button>
        </div>
      </div>
    </>
  );
}
