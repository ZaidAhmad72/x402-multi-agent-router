import { useState, useEffect } from 'react';
import {
  X,
  Sparkles,
  MessageSquare,
  Mic,
  Zap,
  Eye,
  ShieldCheck,
  Award,
  Wallet,
  Coins,
  Wrench,
  Layers,
  ChevronRight,
  ChevronLeft,
  Check,
  ArrowRight,
  CheckCircle2,
  Cpu,
} from 'lucide-react';
import './tutorial-modal.css';

export interface TutorialModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectExampleTask?: (task: string) => void;
}

export default function TutorialModal({ isOpen, onClose, onSelectExampleTask }: TutorialModalProps) {
  const [activeStep, setActiveStep] = useState(0);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        handleClose();
      } else if (e.key === 'ArrowRight' && activeStep < STEPS.length - 1) {
        setActiveStep(prev => prev + 1);
      } else if (e.key === 'ArrowLeft' && activeStep > 0) {
        setActiveStep(prev => prev - 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, activeStep]);

  if (!isOpen) return null;

  const handleClose = () => {
    if (dontShowAgain) {
      localStorage.setItem('has_seen_tutorial', 'true');
    }
    onClose();
  };

  const handleExampleClick = (task: string) => {
    if (onSelectExampleTask) {
      onSelectExampleTask(task);
    }
    handleClose();
  };

  const STEPS = [
    {
      id: 'intro',
      num: 1,
      title: 'Atomic Multi-Agent Router Overview',
      subtitle: 'Algorand TestNet Multi-Agent Service Settlement',
      icon: <Sparkles size={24} />,
      content: (
        <div className="tm-step-content">
          <p style={{ color: 'var(--text-muted)', fontSize: '14px', lineHeight: '1.6', marginBottom: '16px' }}>
            Welcome! The <strong>Atomic Multi-Agent Service Router</strong> orchestrates specialized AI agents (Weather, Research, Analysis, Writer, Formatter) to solve complex user prompts. All quotes and agent payments are settled <em>atomically</em> in a single Algorand TestNet transaction group.
          </p>

          <div className="tm-diagram-container">
            <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', fontWeight: 600 }}>
              Live System Pipeline Workflow
            </div>
            <div className="tm-diagram-flow">
              <div className="tm-diagram-node">
                <MessageSquare size={14} /> User Prompt
              </div>
              <span className="tm-diagram-arrow">➔</span>
              <div className="tm-diagram-node router">
                <Cpu size={14} /> Router & Quality Gate
              </div>
              <span className="tm-diagram-arrow">➔</span>
              <div className="tm-diagram-node agents">
                <Layers size={14} /> 5 Specialized Agents
              </div>
              <span className="tm-diagram-arrow">➔</span>
              <div className="tm-diagram-node blockchain">
                <Coins size={14} /> Algorand Atomic Settlement
              </div>
            </div>
          </div>

          <div className="tm-grid-2">
            <div className="tm-card highlight">
              <h4 className="tm-card-title">
                <CheckCircle2 size={16} style={{ color: '#10b981' }} /> Atomic Commitment
              </h4>
              <p className="tm-card-desc">
                N agent quotes, 1 transaction group. Either all winning agents execute and get paid, or no transactions commit.
              </p>
            </div>
            <div className="tm-card highlight">
              <h4 className="tm-card-title">
                <CheckCircle2 size={16} style={{ color: '#10b981' }} /> Zero Spend on Failure
              </h4>
              <p className="tm-card-desc">
                If an agent fails quality checks or liveness, no funds leave your wallet balance!
              </p>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'asking',
      num: 2,
      title: 'How to Enter Tasks & Dictate',
      subtitle: 'Prompts, Voice Control & Max Spend Budget',
      icon: <MessageSquare size={24} />,
      content: (
        <div className="tm-step-content">
          <p style={{ color: 'var(--text-muted)', fontSize: '14px', lineHeight: '1.6', marginBottom: '16px' }}>
            Type your instruction into the main prompt box or use the <strong>Voice Microphone</strong> button to speak directly to the router! You can also control the maximum USDC budget per run using <strong>Max Spend ($)</strong>.
          </p>

          <div className="tm-grid-2">
            <div className="tm-card">
              <h4 className="tm-card-title">
                <Mic size={16} style={{ color: '#a78bfa' }} /> Voice Speech-to-Text
              </h4>
              <p className="tm-card-desc">
                Click the microphone icon near the input box to dictate your request in real-time.
              </p>
            </div>
            <div className="tm-card">
              <h4 className="tm-card-title">
                <Wallet size={16} style={{ color: '#60a5fa' }} /> Max Spend Guard ($)
              </h4>
              <p className="tm-card-desc">
                Set a budget cap (e.g. $0.10). If agent quotes exceed this limit, routing halts safely.
              </p>
            </div>
          </div>

          <div style={{ marginTop: '20px' }}>
            <h4 style={{ fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', marginBottom: '10px' }}>
              💡 Click an example prompt to try now:
            </h4>
            <div className="tm-prompts-list">
              <div
                className="tm-prompt-chip"
                onClick={() => handleExampleClick('Summarize algorand x402 atomic groups for a hackathon judge')}
              >
                <span>"Summarize algorand x402 atomic groups for a hackathon judge"</span>
                <ArrowRight size={14} />
              </div>
              <div
                className="tm-prompt-chip"
                onClick={() => handleExampleClick('Get Tokyo weather, analyze forecast & summarize in a clean report')}
              >
                <span>"Get Tokyo weather, analyze forecast & summarize in a clean report"</span>
                <ArrowRight size={14} />
              </div>
              <div
                className="tm-prompt-chip"
                onClick={() => handleExampleClick('Research AI agent router architectures and format key takeaways')}
              >
                <span>"Research AI agent router architectures and format key takeaways"</span>
                <ArrowRight size={14} />
              </div>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'modes',
      num: 3,
      title: 'Route (Live Payment) vs Preview (Free)',
      subtitle: 'Choose between real testnet settlement or instant free simulation',
      icon: <Zap size={24} />,
      content: (
        <div className="tm-step-content">
          <p style={{ color: 'var(--text-muted)', fontSize: '14px', lineHeight: '1.6', marginBottom: '16px' }}>
            The router provides two execution modes depending on whether you want to perform real blockchain transactions or test for free:
          </p>

          <div className="tm-grid-2">
            <div className="tm-card highlight" style={{ borderLeft: '4px solid #10b981' }}>
              <h4 className="tm-card-title" style={{ color: '#34d399' }}>
                <Eye size={18} /> Preview Mode (Free - $0.00)
              </h4>
              <p className="tm-card-desc" style={{ marginBottom: '10px' }}>
                Runs the entire multi-agent pipeline instantly in simulation mode.
              </p>
              <ul style={{ paddingLeft: '16px', fontSize: '12px', color: 'var(--text-muted)' }}>
                <li>No testnet wallet payments required</li>
                <li>Inspect raw agent findings & draft formatting</li>
                <li>Ideal for prompt testing and debugging</li>
              </ul>
            </div>

            <div className="tm-card highlight" style={{ borderLeft: '4px solid #8b5cf6' }}>
              <h4 className="tm-card-title" style={{ color: '#c084fc' }}>
                <Zap size={18} /> Route Mode (Live Payment)
              </h4>
              <p className="tm-card-desc" style={{ marginBottom: '10px' }}>
                Executes complete end-to-end atomic settlement on Algorand TestNet.
              </p>
              <ul style={{ paddingLeft: '16px', fontSize: '12px', color: 'var(--text-muted)' }}>
                <li>Quality gates check every agent quote</li>
                <li>Escrow & Atomic Group settlement committed</li>
                <li>Generates verifiable Algorand Group ID link</li>
              </ul>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'quality',
      num: 4,
      title: 'Quality Gate & Reputation Guard',
      subtitle: 'Automated verification, slashing bad actors & replay protection',
      icon: <ShieldCheck size={24} />,
      content: (
        <div className="tm-step-content">
          <p style={{ color: 'var(--text-muted)', fontSize: '14px', lineHeight: '1.6', marginBottom: '16px' }}>
            To protect users from bad output or dishonest agents, the system embeds <strong>Automated Quality Gates</strong> and an <strong>Abuse Guard Reputation System</strong>.
          </p>

          <div className="tm-grid-2">
            <div className="tm-card">
              <h4 className="tm-card-title">
                <Award size={16} style={{ color: '#10b981' }} /> Quality Gate Verifiers
              </h4>
              <p className="tm-card-desc">
                Every agent payload is evaluated for structure and completion. Failing agents are slashed ($0 payout) and excluded from settlement.
              </p>
            </div>

            <div className="tm-card">
              <h4 className="tm-card-title">
                <ShieldCheck size={16} style={{ color: '#f59e0b' }} /> Replay Attack Guard
              </h4>
              <p className="tm-card-desc">
                Cryptographic hash checking prevents duplicate or replayed agent submissions (returns HTTP 409 guard rejection).
              </p>
            </div>
          </div>

          <div className="tm-card" style={{ marginTop: '16px', background: 'rgba(245, 158, 11, 0.08)', borderColor: 'rgba(245, 158, 11, 0.3)' }}>
            <h4 className="tm-card-title" style={{ color: '#fbbf24' }}>
              🛡️ How Reputation works for Agents
            </h4>
            <p className="tm-card-desc">
              Agents gain reputation when providing valid quotes and clean results. If an agent consistently fails quality verifications, its reputation score drops and it is automatically deprioritized.
            </p>
          </div>
        </div>
      ),
    },
    {
      id: 'balances',
      num: 5,
      title: 'Wallet Balances & Settlement Receipts',
      subtitle: 'Tracking USDC funds across Router and Agent accounts',
      icon: <Wallet size={24} />,
      content: (
        <div className="tm-step-content">
          <p style={{ color: 'var(--text-muted)', fontSize: '14px', lineHeight: '1.6', marginBottom: '16px' }}>
            The right panel displays live <strong>Algorand TestNet Balances</strong> for your user account and all connected agent services (Weather, Research, Analysis, Writer, Formatter).
          </p>

          <div className="tm-grid-2">
            <div className="tm-card">
              <h4 className="tm-card-title">
                <Coins size={16} style={{ color: '#3b82f6' }} /> Transparent Receipts
              </h4>
              <p className="tm-card-desc">
                After every task execution, an itemized receipt reveals exactly which agents were paid or slashed, along with the precise USD amount.
              </p>
            </div>

            <div className="tm-card">
              <h4 className="tm-card-title">
                <CheckCircle2 size={16} style={{ color: '#10b981' }} /> Blockchain Explorer
              </h4>
              <p className="tm-card-desc">
                Click on any settlement <strong>Group ID</strong> link to view the live atomic transaction block directly on the Algorand TestNet explorer!
              </p>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'views',
      num: 6,
      title: 'User View vs Developer View',
      subtitle: 'Seamlessly switch between clean chat UI and debug control panel',
      icon: <Wrench size={24} />,
      content: (
        <div className="tm-step-content">
          <p style={{ color: 'var(--text-muted)', fontSize: '14px', lineHeight: '1.6', marginBottom: '16px' }}>
            You can toggle between two interface views anytime using the top navigation bar or sidebar:
          </p>

          <div className="tm-grid-2">
            <div className="tm-card highlight">
              <h4 className="tm-card-title" style={{ color: '#60a5fa' }}>
                <Sparkles size={16} /> User View
              </h4>
              <p className="tm-card-desc">
                A clean, modern chat interface designed for end users — focused on conversation history, step traces, and final agent outputs.
              </p>
            </div>

            <div className="tm-card highlight">
              <h4 className="tm-card-title" style={{ color: '#a78bfa' }}>
                <Wrench size={16} /> Developer View
              </h4>
              <p className="tm-card-desc">
                Full instrumented control panel for judges and developers — includes individual agent Kill Switches, Quality Gate mode overrides, and Replay Self-Testing!
              </p>
            </div>
          </div>

          <div style={{ marginTop: '24px', textAlign: 'center' }}>
            <button
              className="tm-btn success"
              onClick={handleClose}
              style={{ padding: '12px 28px', fontSize: '15px' }}
            >
              <Check size={18} /> Got It! Start Using Router
            </button>
          </div>
        </div>
      ),
    },
  ];

  const currentStepData = STEPS[activeStep];
  const progressPercent = ((activeStep + 1) / STEPS.length) * 100;

  return (
    <div className="tm-overlay" onClick={handleClose}>
      <div className="tm-window" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="tm-header">
          <div className="tm-title-box">
            <span className="tm-badge">Interactive Guide</span>
            <h3 className="tm-title">How the Router Works</h3>
          </div>
          <button className="tm-close-btn" onClick={handleClose} title="Close tutorial (Esc)">
            <X size={18} />
          </button>
        </div>

        {/* Progress Track */}
        <div className="tm-progress-track">
          <div className="tm-progress-fill" style={{ width: `${progressPercent}%` }} />
        </div>

        {/* Navigation Tabs */}
        <div className="tm-tabs-bar">
          {STEPS.map((step, idx) => {
            const isActive = idx === activeStep;
            const isCompleted = idx < activeStep;
            return (
              <div
                key={step.id}
                className={`tm-tab-chip ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}`}
                onClick={() => setActiveStep(idx)}
              >
                <div className="tm-tab-num">
                  {isCompleted ? <Check size={12} /> : step.num}
                </div>
                <span>{step.id === 'intro' ? 'Overview' : step.id === 'asking' ? 'Ask & Dictate' : step.id === 'modes' ? 'Route vs Preview' : step.id === 'quality' ? 'Quality Gate' : step.id === 'balances' ? 'Balances' : 'Dev vs User'}</span>
              </div>
            );
          })}
        </div>

        {/* Step Body */}
        <div className="tm-body">
          <div className="tm-step-header">
            <div className="tm-step-icon-box">
              {currentStepData.icon}
            </div>
            <div>
              <h2 className="tm-step-title">{currentStepData.title}</h2>
              <p className="tm-step-subtitle">{currentStepData.subtitle}</p>
            </div>
          </div>

          {currentStepData.content}
        </div>

        {/* Footer */}
        <div className="tm-footer">
          <label className="tm-dont-show">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={e => setDontShowAgain(e.target.checked)}
            />
            <span>Don't show automatically next time</span>
          </label>

          <div className="tm-nav-actions">
            {activeStep > 0 && (
              <button
                className="tm-btn secondary"
                onClick={() => setActiveStep(prev => prev - 1)}
              >
                <ChevronLeft size={16} /> Back
              </button>
            )}

            {activeStep < STEPS.length - 1 ? (
              <button
                className="tm-btn primary"
                onClick={() => setActiveStep(prev => prev + 1)}
              >
                Next <ChevronRight size={16} />
              </button>
            ) : (
              <button
                className="tm-btn success"
                onClick={handleClose}
              >
                <Check size={16} /> Finish Tutorial
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
