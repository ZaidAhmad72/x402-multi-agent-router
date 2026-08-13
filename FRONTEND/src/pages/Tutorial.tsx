import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Wallet, MessageSquare, Zap, User, ShieldCheck, Sparkles, Play } from 'lucide-react';
import '../index.css';
import TutorialModal from '../components/TutorialModal';

export default function Tutorial() {
  const navigate = useNavigate();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleLaunchChat = () => {
    const user = localStorage.getItem('session_user') || 'demo';
    navigate(`/user/${user}`);
  };

  return (
    <div className="tutorial-container" style={{ padding: '40px 24px', maxWidth: '860px', margin: '0 auto' }}>
      <TutorialModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSelectExampleTask={() => handleLaunchChat()}
      />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '30px' }}>
        <button
          className="btn"
          onClick={() => navigate(-1)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        >
          <ArrowLeft size={16} />
          Back
        </button>

        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            className="btn"
            onClick={() => setIsModalOpen(true)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              background: 'rgba(139, 92, 246, 0.15)',
              color: '#c084fc',
              borderColor: 'rgba(139, 92, 246, 0.4)'
            }}
          >
            <Sparkles size={16} /> Open Interactive Modal
          </button>
          <button
            className="btn primary"
            onClick={handleLaunchChat}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <Play size={16} /> Go to Router Workspace
          </button>
        </div>
      </div>

      <div style={{ marginBottom: '40px' }}>
        <span className="badge primary" style={{ marginBottom: '12px', display: 'inline-block' }}>User Documentation</span>
        <h1 style={{ fontSize: '36px', marginBottom: '12px' }}>Atomic Multi-Agent Service Router Tutorial</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '16px', lineHeight: '1.6' }}>
          Learn how to orchestrate specialized AI agents (Weather, Research, Analysis, Writer, Formatter) with automated quality gates and Algorand TestNet atomic settlements.
        </p>
      </div>

      <div className="tutorial-steps">
        <div className="glass-panel" style={{ padding: '24px', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
            <div style={{ background: 'var(--primary)', color: 'white', width: '32px', height: '32px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', marginRight: '16px' }}>1</div>
            <h2 style={{ margin: 0, display: 'flex', alignItems: 'center' }}>
              <User size={20} style={{ marginRight: '8px', color: 'var(--primary)' }} />
              Register & Workspace Login
            </h2>
          </div>
          <p style={{ color: 'var(--text-muted)', marginLeft: '48px', lineHeight: '1.6' }}>
            Start by entering a username on the login screen. Once logged in, your workspace stores your chat sessions, custom task routes, and live wallet state.
          </p>
        </div>

        <div className="glass-panel" style={{ padding: '24px', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
            <div style={{ background: 'var(--primary)', color: 'white', width: '32px', height: '32px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', marginRight: '16px' }}>2</div>
            <h2 style={{ margin: 0, display: 'flex', alignItems: 'center' }}>
              <Wallet size={20} style={{ marginRight: '8px', color: 'var(--primary)' }} />
              Algorand TestNet Wallet & Max Spend Limit
            </h2>
          </div>
          <p style={{ color: 'var(--text-muted)', marginLeft: '48px', lineHeight: '1.6' }}>
            The router requires USDC funds on Algorand TestNet. Set a budget limit with the <strong>Max Spend ($)</strong> field (default $0.10). If agent quotes exceed your budget cap, routing aborts safely.
          </p>
        </div>

        <div className="glass-panel" style={{ padding: '24px', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
            <div style={{ background: 'var(--primary)', color: 'white', width: '32px', height: '32px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', marginRight: '16px' }}>3</div>
            <h2 style={{ margin: 0, display: 'flex', alignItems: 'center' }}>
              <MessageSquare size={20} style={{ marginRight: '8px', color: 'var(--primary)' }} />
              Submit Tasks & Voice Dictation
            </h2>
          </div>
          <p style={{ color: 'var(--text-muted)', marginLeft: '48px', lineHeight: '1.6' }}>
            Enter your task in the chat input or use the <strong>Voice Speech-to-Text Microphone</strong> to dictate your prompt. The router dynamically analyzes the prompt and picks the best agents to execute it.
          </p>
        </div>

        <div className="glass-panel" style={{ padding: '24px', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
            <div style={{ background: 'var(--primary)', color: 'white', width: '32px', height: '32px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', marginRight: '16px' }}>4</div>
            <h2 style={{ margin: 0, display: 'flex', alignItems: 'center' }}>
              <ShieldCheck size={20} style={{ marginRight: '8px', color: 'var(--primary)' }} />
              Automated Quality Gates & Replay Protection
            </h2>
          </div>
          <p style={{ color: 'var(--text-muted)', marginLeft: '48px', lineHeight: '1.6' }}>
            Before payment settlement, automated quality gates verify agent outputs. Replay attack protection rejects duplicate submissions (HTTP 409 guard), ensuring only valid outputs are rewarded.
          </p>
        </div>
      </div>

      <div className="glass-panel" style={{ padding: '30px', marginTop: '40px', borderLeft: '4px solid var(--warning)' }}>
        <h3 style={{ marginBottom: '16px', display: 'flex', alignItems: 'center' }}>
          <Zap size={20} style={{ marginRight: '8px', color: 'var(--warning)' }} />
          Billing Rules: What Deducts Balance?
        </h3>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          <div>
            <h4 style={{ color: 'var(--success)', marginBottom: '8px' }}>Deducts Balance</h4>
            <ul style={{ color: 'var(--text-muted)', paddingLeft: '20px' }}>
              <li style={{ marginBottom: '8px' }}>Executing a "Route (Live Payment)" task.</li>
              <li style={{ marginBottom: '8px' }}>Successfully settling quotes with agents (the transaction group completes).</li>
            </ul>
          </div>

          <div>
            <h4 style={{ color: 'var(--success)', marginBottom: '8px' }}>Does NOT Deduct Balance</h4>
            <ul style={{ color: 'var(--text-muted)', paddingLeft: '20px' }}>
              <li style={{ marginBottom: '8px' }}>Using the "Preview (no payment)" feature ($0.00).</li>
              <li style={{ marginBottom: '8px' }}>If any agent fails during quality check or liveness check.</li>
              <li style={{ marginBottom: '8px' }}>If total quote exceeds your specified Max Spend limit.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
