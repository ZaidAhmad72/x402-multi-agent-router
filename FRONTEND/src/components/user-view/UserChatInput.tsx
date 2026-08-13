import { Mic, MicOff, ArrowUp } from 'lucide-react';

export interface UserChatInputProps {
  input: string;
  setInput: (value: string) => void;
  onSend: () => void;
  isListening: boolean;
  interimTranscript: string;
  toggleListening: () => void;
  maxSpend: number;
  setMaxSpend: (value: number) => void;
  previewMode: boolean;
  setPreviewMode: (value: boolean) => void;
  disabled?: boolean;
}

export default function UserChatInput(props: UserChatInputProps) {
  const {
    input, setInput, onSend, isListening, interimTranscript, toggleListening,
    maxSpend, setMaxSpend, previewMode, setPreviewMode, disabled,
  } = props;

  const displayValue = input + (interimTranscript ? (input && !input.endsWith(' ') ? ' ' : '') + interimTranscript : '');

  return (
    <div className="uv-input-dock">
      <div className="uv-input-bar">
        <textarea
          rows={1}
          placeholder="Ask about weather, currency, or anything the agents can help with…"
          value={displayValue}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (input.trim() && !disabled) onSend();
            }
          }}
        />
        <div className="uv-input-actions">
          <button
            type="button"
            className={`uv-mic-btn ${isListening ? 'active' : ''}`}
            onClick={toggleListening}
            title="Voice to text"
          >
            {isListening ? <MicOff size={17} /> : <Mic size={17} />}
          </button>
          <button
            type="button"
            className="uv-send-btn"
            onClick={onSend}
            disabled={!input.trim() || disabled}
            title={previewMode ? 'Preview (no payment)' : 'Send'}
          >
            <ArrowUp size={18} />
          </button>
        </div>
      </div>
      <div className="uv-input-meta">
        <div
          className={`uv-preview-toggle ${previewMode ? 'on' : ''}`}
          onClick={() => setPreviewMode(!previewMode)}
          title="Preview runs every agent for free and shows what they'd return, without paying or settling on-chain"
        >
          <span className="sw" />
          Preview only (no payment)
        </div>
        <div className="uv-maxspend">
          Max spend $
          <input
            type="number"
            step="0.01"
            value={maxSpend}
            onChange={(e) => setMaxSpend(parseFloat(e.target.value))}
          />
        </div>
      </div>
    </div>
  );
}
