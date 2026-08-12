import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Wallet, MessageSquare, Zap, User } from 'lucide-react';
import '../index.css';

export default function Tutorial() {
  const navigate = useNavigate();

  return (
    <div className="tutorial-container" style={{ padding: '40px', maxWidth: '800px', margin: '0 auto' }}>
      <button 
        className="btn" 
        onClick={() => navigate(-1)} 
        style={{ marginBottom: '30px', display: 'inline-flex', alignItems: 'center' }}
      >
        <ArrowLeft size={16} style={{ marginRight: '6px' }} />
        Back
      </button>

      <h1 style={{ fontSize: '36px', marginBottom: '16px' }}>How to use the Router</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: '16px', marginBottom: '40px' }}>
        Learn how to orchestrate multiple agents and manage your balance.
      </p>

      <div className="tutorial-steps">
        <div className="glass-panel" style={{ padding: '24px', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
            <div style={{ background: 'var(--primary)', color: 'white', width: '32px', height: '32px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', marginRight: '16px' }}>1</div>
            <h2 style={{ margin: 0, display: 'flex', alignItems: 'center' }}>
              <User size={20} style={{ marginRight: '8px', color: 'var(--primary)' }} />
              Register & Login
            </h2>
          </div>
          <p style={{ color: 'var(--text-muted)', marginLeft: '48px' }}>
            Start by creating an account on the landing page. Once registered, login to access your personalized workspace where tasks are routed.
          </p>
        </div>

        <div className="glass-panel" style={{ padding: '24px', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
            <div style={{ background: 'var(--primary)', color: 'white', width: '32px', height: '32px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', marginRight: '16px' }}>2</div>
            <h2 style={{ margin: 0, display: 'flex', alignItems: 'center' }}>
              <Wallet size={20} style={{ marginRight: '8px', color: 'var(--primary)' }} />
              Add Money to Wallet
            </h2>
          </div>
          <p style={{ color: 'var(--text-muted)', marginLeft: '48px' }}>
            The router requires USDC on the Algorand TestNet. Before dispatching tasks that require payments, ensure your connected wallet has a sufficient budget.
          </p>
        </div>

        <div className="glass-panel" style={{ padding: '24px', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
            <div style={{ background: 'var(--primary)', color: 'white', width: '32px', height: '32px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', marginRight: '16px' }}>3</div>
            <h2 style={{ margin: 0, display: 'flex', alignItems: 'center' }}>
              <MessageSquare size={20} style={{ marginRight: '8px', color: 'var(--primary)' }} />
              Ask Something in Chat
            </h2>
          </div>
          <p style={{ color: 'var(--text-muted)', marginLeft: '48px' }}>
            Enter your task in the chat input. The system will process your request and route it through our specialized AI agents. You can even use voice-to-text to dictate your task!
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
              <li style={{ marginBottom: '8px' }}>Successfully settling a quote with agents (the transaction group completes).</li>
            </ul>
          </div>
          
          <div>
            <h4 style={{ color: 'var(--success)', marginBottom: '8px' }}>Does NOT Deduct Balance</h4>
            <ul style={{ color: 'var(--text-muted)', paddingLeft: '20px' }}>
              <li style={{ marginBottom: '8px' }}>Using the "Preview (no payment)" feature.</li>
              <li style={{ marginBottom: '8px' }}>If any agent fails during the QUOTE phase (liveness check fails).</li>
              <li style={{ marginBottom: '8px' }}>If the total quote exceeds your specified Maximum Spend budget.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
