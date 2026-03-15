import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageCircle,
  X,
  Send,
  Mic,
  StopCircle,
  Volume2,
  VolumeX,
  Loader2,
  Bot,
  User,
  Trash2,
  ChevronDown,
  Shield,
  Radio,
  AlertTriangle,
  Paperclip,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  audioBase64?: string;
  timestamp: Date;
}

type VoiceState = 'idle' | 'recording' | 'processing' | 'speaking';

interface LoanGuardChatProps {
  auditContext?: object | null;
  darkMode?: boolean;
}

// ─────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────
const API_BASE = 'http://localhost:8000';

const LANGUAGES = [
  { code: 'en-IN', label: 'English',  flag: '🇬🇧' },
  { code: 'hi-IN', label: 'हिन्दी',   flag: '🇮🇳' },
  { code: 'ta-IN', label: 'தமிழ்',   flag: '🇮🇳' },
  { code: 'te-IN', label: 'తెలుగు',  flag: '🇮🇳' },
  { code: 'kn-IN', label: 'ಕನ್ನಡ',  flag: '🇮🇳' },
  { code: 'ml-IN', label: 'മലയാളം', flag: '🇮🇳' },
  { code: 'mr-IN', label: 'मराठी',   flag: '🇮🇳' },
  { code: 'bn-IN', label: 'বাংলা',   flag: '🇮🇳' },
];

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function uid() {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Strip <think>...</think> blocks from model output.
 * The model often puts its entire response inside <think>...</think>,
 * so we take everything AFTER the closing tag, not remove what's inside.
 */
function stripThinkTags(text: string): string {
  // If properly closed, take what's after </think>
  if (text.includes('</think>')) {
    return text.split('</think>').pop()?.trim() ?? '';
  }
  // If <think> opened but never closed, content IS the answer
  if (text.trimStart().startsWith('<think>')) {
    return text.trimStart().slice('<think>'.length).trim();
  }
  return text.trim();
}

/** Decode base64 WAV/audio and play it. Returns Promise that resolves when done. */
function playBase64Audio(b64: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
      audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
      audio.play().catch(() => resolve());
    } catch {
      resolve();
    }
  });
}

// ─────────────────────────────────────────────
// Typing indicator
// ─────────────────────────────────────────────
const TypingIndicator = () => (
  <div className="flex items-end gap-2">
    <div className="w-7 h-7 rounded-full bg-brand-100 dark:bg-brand-900/40 flex items-center justify-center flex-shrink-0">
      <Bot className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400" />
    </div>
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
      <div className="flex gap-1 items-center h-4">
        {[0, 1, 2].map(i => (
          <motion.div
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500"
            animate={{ y: [0, -4, 0] }}
            transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
          />
        ))}
      </div>
    </div>
  </div>
);

// ─────────────────────────────────────────────
// Sound wave (shown while AI is speaking)
// ─────────────────────────────────────────────
const SoundWave = () => (
  <div className="flex items-center gap-0.5 h-6">
    {[0.4, 0.7, 1, 0.7, 0.4, 0.9, 0.5].map((h, i) => (
      <motion.div
        key={i}
        className="w-1 rounded-full bg-white"
        animate={{ scaleY: [h, 1, h * 0.5, 1, h] }}
        transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.1, ease: 'easeInOut' }}
        style={{ height: '100%', transformOrigin: 'center' }}
      />
    ))}
  </div>
);

// ─────────────────────────────────────────────
// Chat bubble
// ─────────────────────────────────────────────
const ChatBubble: React.FC<{ msg: Message; onPlay: (b64: string) => Promise<void> }> = ({ msg, onPlay }) => {
  const isUser = msg.role === 'user';
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`flex items-end gap-2 ${isUser ? 'flex-row-reverse' : ''}`}
    >
      <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
        isUser ? 'bg-brand-500' : 'bg-brand-100 dark:bg-brand-900/40'
      }`}>
        {isUser
          ? <User className="w-3.5 h-3.5 text-white" />
          : <Bot className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400" />}
      </div>

      <div className={`max-w-[78%] flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
        <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed shadow-sm ${
          isUser
            ? 'bg-brand-500 text-white rounded-br-sm'
            : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-100 rounded-bl-sm'
        }`}>
          <ReactMarkdown
            components={{
              h2: ({ node, ...props }) => (
                <h2 className="font-semibold text-sm mt-2 mb-1" {...props} />
              ),
              li: ({ node, ...props }) => (
                <li className="text-sm ml-4 list-disc" {...props} />
              ),
            }}
          >
            {msg.text}
          </ReactMarkdown>
        </div>

        {msg.audioBase64 && (
          <button
            onClick={() => onPlay(msg.audioBase64!)}
            className="flex items-center gap-1 text-xs text-brand-500 dark:text-brand-400 hover:text-brand-600 transition-colors"
          >
            <Volume2 className="w-3 h-3" />
            Replay
          </button>
        )}

        <span className="text-[10px] text-gray-400 dark:text-gray-600 px-1">
          {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </motion.div>
  );
};

// ─────────────────────────────────────────────
// Voice orb — big central button
// ─────────────────────────────────────────────
const VoiceOrb: React.FC<{ state: VoiceState; onPress: () => void }> = ({ state, onPress }) => {
  const isInteractive = state === 'idle' || state === 'recording';

  const colorMap = {
    idle:       'bg-brand-500 hover:bg-brand-600 shadow-brand-400/30',
    recording:  'bg-red-500 shadow-red-400/40',
    processing: 'bg-amber-500 shadow-amber-400/30 cursor-wait',
    speaking:   'bg-emerald-500 shadow-emerald-400/30 cursor-default',
  };

  const labelMap = {
    idle:       'Tap to speak',
    recording:  'Listening… tap to stop',
    processing: 'Transcribing…',
    speaking:   'Speaking…',
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative">
        {/* Pulse rings */}
        {(state === 'recording' || state === 'speaking') && (
          <>
            <motion.div
              className={`absolute inset-0 rounded-full ${state === 'recording' ? 'bg-red-400' : 'bg-emerald-400'}`}
              animate={{ scale: [1, 1.6, 1], opacity: [0.4, 0, 0.4] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.div
              className={`absolute inset-0 rounded-full ${state === 'recording' ? 'bg-red-400' : 'bg-emerald-400'}`}
              animate={{ scale: [1, 1.3, 1], opacity: [0.3, 0, 0.3] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut', delay: 0.4 }}
            />
          </>
        )}

        <motion.button
          whileTap={isInteractive ? { scale: 0.9 } : {}}
          onClick={isInteractive ? onPress : undefined}
          className={`relative w-24 h-24 rounded-full flex items-center justify-center shadow-2xl transition-colors ${colorMap[state]}`}
        >
          {state === 'idle'       && <Mic className="w-9 h-9 text-white" />}
          {state === 'recording'  && <StopCircle className="w-9 h-9 text-white" />}
          {state === 'processing' && <Loader2 className="w-9 h-9 text-white animate-spin" />}
          {state === 'speaking'   && <SoundWave />}
        </motion.button>
      </div>

      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{labelMap[state]}</p>
    </div>
  );
};

// ─────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────
export const LoanGuardChat: React.FC<LoanGuardChatProps> = ({ auditContext, darkMode }) => {
  const [open, setOpen]         = useState(false);
  const [tab, setTab]           = useState<'text' | 'voice'>('text');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [language, setLanguage] = useState('en-IN');
  const [langOpen, setLangOpen] = useState(false);
  const [textTTS, setTextTTS]   = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [sessionId]             = useState(() => `session_${uid()}`);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef        = useRef<Blob[]>([]);
  const bottomRef        = useRef<HTMLDivElement>(null);
  const inputRef         = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, voiceState]);

  useEffect(() => {
    if (open && tab === 'text') setTimeout(() => inputRef.current?.focus(), 200);
  }, [open, tab]);

  // ── Text send ──────────────────────────────
  const sendText = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    const userMsg: Message = { id: uid(), role: 'user', text: trimmed, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/chat/text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id:    sessionId,
          message:       trimmed,
          audit_context: auditContext ?? null,
          language_code: language,
          enable_tts:    textTTS,
          tts_speaker:   'shubh',
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || `Error ${res.status}`);
      const data = await res.json();

      const aMsg: Message = {
        id: uid(),
        role: 'assistant',
        // ✅ Strip <think> tags on the frontend as a safety net
        text: stripThinkTags(data.assistant_message),
        audioBase64: data.audio_base64 ?? undefined,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, aMsg]);
      if (data.audio_base64) await playBase64Audio(data.audio_base64);
    } catch (e: any) {
      setError(e.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }

    
  }, [input, loading, sessionId, auditContext, language, textTTS]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); }
  };

  // ── Voice: start ───────────────────────────
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      chunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.start();
      mediaRecorderRef.current = mr;
      setVoiceState('recording');
      setError(null);
    } catch {
      setError('Microphone access denied. Please allow permissions in your browser.');
    }
  };

  // ── Voice: stop → STT → Chat → TTS ─────────
  const stopAndProcess = useCallback(() => {
    const mr = mediaRecorderRef.current;
    if (!mr || mr.state === 'inactive') return;

    mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    mr.onstop = async () => {
      mr.stream?.getTracks().forEach(t => t.stop());

      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      if (blob.size < 500) {
        setVoiceState('idle');
        setError('Recording too short — please hold the button a bit longer.');
        return;
      }

      setVoiceState('processing');

      const placeholderId = uid();
      setMessages(prev => [...prev, {
        id: placeholderId, role: 'user',
        text: 'Processing your voice…',
        timestamp: new Date(),
      }]);

      try {
        const form = new FormData();
        form.append('session_id',    sessionId);
        form.append('audio_file',    blob, 'voice.webm');
        form.append('language_code', language);
        form.append('enable_tts',    'true');
        form.append('tts_speaker',   'shubh');
        if (auditContext) form.append('audit_context', JSON.stringify(auditContext));

        const res = await fetch(`${API_BASE}/api/chat/voice`, { method: 'POST', body: form });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || `Error ${res.status}`);
        const data = await res.json();

        // Update placeholder with real transcript
        setMessages(prev => prev.map(m =>
          m.id === placeholderId ? { ...m, text: data.user_message } : m
        ));

        // ✅ Strip <think> tags on the frontend as a safety net
        const aMsg: Message = {
          id: uid(),
          role: 'assistant',
          text: stripThinkTags(data.assistant_message),
          audioBase64: data.audio_base64 ?? undefined,
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, aMsg]);

        if (data.audio_base64) {
          setVoiceState('speaking');
          await playBase64Audio(data.audio_base64);
        }

        setVoiceState('idle');
      } catch (e: any) {
        setMessages(prev => prev.filter(m => m.id !== placeholderId));
        setError(e.message || 'Voice processing failed. Please try again.');
        setVoiceState('idle');
      }
    };

    mr.stop();
  }, [sessionId, language, auditContext]);

  const handleOrbPress = () => {
    if (voiceState === 'idle')           startRecording();
    else if (voiceState === 'recording') stopAndProcess();
  };

  // ── Clear session ──────────────────────────
  const clearSession = async () => {
    setMessages([]);
    setError(null);
    setVoiceState('idle');
    try { await fetch(`${API_BASE}/api/chat/session/${sessionId}`, { method: 'DELETE' }); }
    catch { /* silent */ }
  };

  const selectedLang = LANGUAGES.find(l => l.code === language) ?? LANGUAGES[0];

  // ─────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Floating trigger ── */}
      <motion.button
        onClick={() => setOpen(v => !v)}
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.94 }}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-brand-500 hover:bg-brand-600 shadow-lg shadow-brand-500/30 flex items-center justify-center transition-colors"
        aria-label="Open LoanGuard AI Chat"
      >
        <AnimatePresence mode="wait">
          {open
            ? <motion.span key="x" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.15 }}><X className="w-6 h-6 text-white" /></motion.span>
            : <motion.span key="m" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }} transition={{ duration: 0.15 }}><MessageCircle className="w-6 h-6 text-white" /></motion.span>
          }
        </AnimatePresence>
        {auditContext && !open && (
          <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-red-500 rounded-full border-2 border-white dark:border-gray-950 animate-pulse" />
        )}
      </motion.button>

      {/* ── Chat panel ── */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 24, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.95 }}
            transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
            className="fixed bottom-24 right-6 z-50 w-[360px] sm:w-[400px] h-[590px] flex flex-col rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-2xl shadow-black/20 overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-gradient-to-r from-brand-500 to-brand-600">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                  <Shield className="w-4 h-4 text-white" />
                </div>
                <div>
                  <p className="text-sm font-bold text-white leading-tight">LoanGuard AI</p>
                  <p className="text-[10px] text-brand-100 leading-tight">
                    {auditContext ? <><Paperclip className="w-3 h-3 inline mr-0.5" /> Loan audit loaded</> : 'Multilingual Financial Assistant'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1">
                {/* Language picker */}
                <div className="relative">
                  <button
                    onClick={() => setLangOpen(v => !v)}
                    className="flex items-center gap-1 text-xs text-white/90 hover:text-white bg-white/10 hover:bg-white/20 rounded-lg px-2 py-1 transition-colors"
                  >
                    <span>{selectedLang.flag}</span>
                    <span className="hidden sm:inline">{selectedLang.label}</span>
                    <ChevronDown className="w-3 h-3" />
                  </button>
                  <AnimatePresence>
                    {langOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                        className="absolute right-0 top-full mt-1 w-40 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg z-10 overflow-hidden"
                      >
                        {LANGUAGES.map(l => (
                          <button key={l.code} onClick={() => { setLanguage(l.code); setLangOpen(false); }}
                            className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                              language === l.code ? 'bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 font-semibold' : 'text-gray-700 dark:text-gray-300'
                            }`}
                          >
                            <span>{l.flag}</span><span>{l.label}</span>
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* TTS toggle — text tab only */}
                {tab === 'text' && (
                  <button
                    onClick={() => setTextTTS(v => !v)}
                    title={textTTS ? 'Disable voice reply' : 'Enable voice reply'}
                    className={`p-1.5 rounded-lg transition-colors ${textTTS ? 'bg-white/25 text-white' : 'text-white/50 hover:bg-white/10 hover:text-white'}`}
                  >
                    {textTTS ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                  </button>
                )}

                <button onClick={clearSession} title="Clear conversation"
                  className="p-1.5 rounded-lg text-white/50 hover:bg-white/10 hover:text-white transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
              {(['text', 'voice'] as const).map(t => (
                <button key={t} onClick={() => setTab(t)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition-colors ${
                    tab === t
                      ? 'text-brand-600 dark:text-brand-400 border-b-2 border-brand-500 bg-white dark:bg-gray-900'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                  }`}
                >
                  {t === 'text' ? <MessageCircle className="w-3.5 h-3.5" /> : <Radio className="w-3.5 h-3.5" />}
                  {t === 'text' ? 'Text Chat' : 'Voice Chat'}
                </button>
              ))}
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-gray-50/60 dark:bg-gray-950/40 [scrollbar-width:thin]">
              {messages.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center gap-3 py-8">
                  <div className="w-14 h-14 rounded-2xl bg-brand-50 dark:bg-brand-900/30 flex items-center justify-center">
                    <Bot className="w-7 h-7 text-brand-500" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                      {selectedLang.flag} Hi, I'm LoanGuard AI
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 max-w-[220px]">
                      {tab === 'voice'
                        ? "Tap the mic and speak — I'll reply out loud in your language."
                        : auditContext
                        ? 'Your loan audit is loaded. Ask me anything!'
                        : 'Ask about loan agreements, EMI charges, or RBI violations.'}
                    </p>
                  </div>

                  {tab === 'text' && (
                    <div className="flex flex-col gap-1.5 w-full mt-2">
                      {['Is my EMI correctly calculated?', 'Are there any hidden charges?', 'What violations were detected?'].map(q => (
                        <button key={q}
                          onClick={() => { setInput(q); setTimeout(() => inputRef.current?.focus(), 50); }}
                          className="w-full text-left text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-gray-600 dark:text-gray-300 hover:border-brand-300 dark:hover:border-brand-700 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
                        >{q}</button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {messages.map(msg => (
                <ChatBubble key={msg.id} msg={msg} onPlay={playBase64Audio} />
              ))}

              {loading && tab === 'text' && <TypingIndicator />}

              {error && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="flex items-center gap-2 text-xs text-red-500 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-3 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />{error}
                </motion.div>
              )}
              <div ref={bottomRef} />
            </div>

            {/* Input area */}
            <div className="border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">

              {/* TEXT TAB */}
              {tab === 'text' && (
                <div className="flex items-end gap-2">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask about your loan… (Enter to send)"
                    rows={1}
                    disabled={loading}
                    className="flex-1 resize-none text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition-all max-h-28 disabled:opacity-50"
                    onInput={e => {
                      const t = e.target as HTMLTextAreaElement;
                      t.style.height = 'auto';
                      t.style.height = `${Math.min(t.scrollHeight, 112)}px`;
                    }}
                  />
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    onClick={sendText}
                    disabled={!input.trim() || loading}
                    className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </motion.button>
                </div>
              )}

              {/* VOICE TAB */}
              {tab === 'voice' && (
                <div className="flex flex-col items-center gap-3 py-2">
                  <VoiceOrb state={voiceState} onPress={handleOrbPress} />

                  <AnimatePresence mode="wait">
                    {voiceState === 'speaking' && (
                      <motion.div key="spk"
                        initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-full px-3 py-1"
                      >
                        <Volume2 className="w-3 h-3" />
                        LoanGuard AI is speaking…
                      </motion.div>
                    )}
                    {voiceState === 'processing' && (
                      <motion.div key="proc"
                        initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-full px-3 py-1"
                      >
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Transcribing &amp; thinking…
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <p className="text-[10px] text-gray-400 dark:text-gray-600 flex items-center gap-1">
                    <Volume2 className="w-2.5 h-2.5" /> Voice replies always on in Voice Chat
                  </p>
                </div>
              )}

              <p className="text-[10px] text-gray-400 dark:text-gray-600 text-center mt-1.5">
                LoanGuard AI · Not a substitute for legal advice
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};