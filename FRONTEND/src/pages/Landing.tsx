import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Lock, Activity, Sparkles, Zap, Fingerprint } from 'lucide-react';
import '../index.css';

export default function Landing() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');

  const [errorMsg, setErrorMsg] = useState('');
  const [savedAccounts, setSavedAccounts] = useState<string[]>([]);

  useEffect(() => {
    const accs = localStorage.getItem('saved_accounts');
    if (accs) {
      setSavedAccounts(JSON.parse(accs));
    }
  }, []);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;
    setErrorMsg('');

    const endpoint = activeTab === 'login' ? '/auth/login' : '/auth/register';
    const payload = activeTab === 'login' 
      ? { username, password } 
      : { username, password, name };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (!res.ok) {
        setErrorMsg(data.error || 'Authentication failed');
        return;
      }

      localStorage.setItem('session_user', username);
      if (data.token) {
        localStorage.setItem('auth_token', data.token);
      }
      const accs = new Set(savedAccounts);
      accs.add(username);
      const newAccs = Array.from(accs);
      localStorage.setItem('saved_accounts', JSON.stringify(newAccs));
      
      navigate(`/user/${encodeURIComponent(username)}`);
    } catch (err: any) {
      setErrorMsg(err.message || 'Network error');
    }
  };

  const loginAsSaved = (user: string) => {
    localStorage.setItem('session_user', user);
    navigate(`/user/${encodeURIComponent(user)}`);
  };

  return (
    <div className="landing-container">
      {/* Background Decor */}
      <div className="bg-shape shape-1"></div>
      <div className="bg-shape shape-2"></div>
      
      <div className="landing-grid">
        {/* Left: Hero Section */}
        <div className="hero-section">
          <div className="badge-glow">
            <Sparkles size={14} style={{ marginRight: '6px' }} />
            Next-Gen Agent Orchestration
          </div>
          
          <h1 className="hero-title">
            Atomic Multi-Agent
            <span className="text-gradient"> Service Router</span>
          </h1>
          
          <p className="hero-subtitle">
            N quotes, one group, one atomic commitment. Seamlessly route tasks to specialized agents, settle payments atomically on Algorand TestNet, and get combined results instantly.
          </p>
          
          <div className="feature-list">
            <div className="feature-item">
              <div className="feature-icon"><Zap size={18} /></div>
              <div>
                <h3 style={{fontSize:'14px', color:'#fff', marginBottom:'2px'}}>Atomic Settlement</h3>
                <p style={{fontSize:'13px', color:'var(--text-muted)'}}>All agents are paid simultaneously via transaction groups.</p>
              </div>
            </div>
            <div className="feature-item">
              <div className="feature-icon"><Activity size={18} /></div>
              <div>
                <h3 style={{fontSize:'14px', color:'#fff', marginBottom:'2px'}}>Live Processing Logs</h3>
                <p style={{fontSize:'13px', color:'var(--text-muted)'}}>Transparent insight into the QUOTE, SETTLE, REDEEM phases.</p>
              </div>
            </div>
            <div className="feature-item">
              <div className="feature-icon"><Fingerprint size={18} /></div>
              <div>
                <h3 style={{fontSize:'14px', color:'#fff', marginBottom:'2px'}}>Fee Abstraction</h3>
                <p style={{fontSize:'13px', color:'var(--text-muted)'}}>Agent wallets never sign fee-bearing transactions.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Auth Section */}
        <div className="auth-section">
          <div className="glass-panel auth-panel">
            <div className="auth-tabs">
              <button 
                className={`auth-tab ${activeTab === 'login' ? 'active' : ''}`}
                onClick={() => setActiveTab('login')}
              >
                Login
              </button>
              <button 
                className={`auth-tab ${activeTab === 'register' ? 'active' : ''}`}
                onClick={() => setActiveTab('register')}
              >
                Register
              </button>
            </div>
            
            {savedAccounts.length > 0 && (
              <div style={{ marginBottom: '20px', padding: '12px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '8px', textAlign: 'center' }}>Recent Accounts</p>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
                  {savedAccounts.map(acc => (
                    <button key={acc} type="button" onClick={() => loginAsSaved(acc)} className="btn" style={{ padding: '6px 12px', fontSize: '12px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)' }}>
                      <User size={12} style={{ display: 'inline', marginRight: '4px' }} /> {acc}
                    </button>
                  ))}
                </div>
              </div>
            )}
            
            <form onSubmit={handleAuth} className="auth-form">
              <div className="form-group">
                <label>Username</label>
                <div className="input-with-icon">
                  <User size={16} />
                  <input 
                    type="text" 
                    placeholder="Enter your username" 
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                  />
                </div>
              </div>

              {activeTab === 'register' && (
                <div className="form-group">
                  <label>Full Name</label>
                  <div className="input-with-icon">
                    <User size={16} />
                    <input 
                      type="text" 
                      placeholder="Enter your name" 
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                    />
                  </div>
                </div>
              )}

              <div className="form-group">
                <label>Password</label>
                <div className="input-with-icon">
                  <Lock size={16} />
                  <input 
                    type="password" 
                    placeholder="Enter your password" 
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
              </div>

              <button type="submit" className="btn primary full-width mt-4" style={{marginTop: '20px', padding: '12px', fontSize: '15px'}}>
                {activeTab === 'login' ? 'Login' : 'Create Account'}
              </button>
              
              {errorMsg && (
                <div style={{ color: 'var(--danger)', fontSize: '13px', marginTop: '12px', textAlign: 'center' }}>
                  {errorMsg}
                </div>
              )}
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
