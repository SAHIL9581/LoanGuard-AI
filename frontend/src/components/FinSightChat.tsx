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
  Brain,
  Radio,
  AlertTriangle,
  FileText,
  TrendingUp,
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

interface FinSightChatProps {
  context?: any | null;
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
  { code: 'kn-IN', label: 'ಕನ್ನಡ',  flag: 'ಕ' },
  { code: 'ml-IN', label: 'മലയാളം', flag: 'മ' },
  { code: 'mr-IN', label: 'मराठी',   flag: 'म' },
  { code: 'bn-IN', label: 'বাংলা',   flag: 'ব' },
];

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function stripThinkTags(text: string): string {
  if (text.includes('</think>')) {
    return text.split('</think>').pop()?.trim() ?? '';
  }
  if (text.trimStart().startsWith('<think>')) {
    return text.trimStart().slice('<think>'.length).trim();
  }
  return text.trim();
}

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

function stopPlayback(audioRef: React.MutableRefObject<HTMLAudioElement | null>, urlRef: React.MutableRefObject<string | null>) {
  if (audioRef.current) {
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
    audioRef.current = null;
  }
  if (urlRef.current) {
    URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  }
}

// ─────────────────────────────────────────────
// UI Components
// ─────────────────────────────────────────────
const TypingIndicator = () => (
  <div className="flex items-end gap-2">
    <div className="w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center flex-shrink-0">
      <Bot className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
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
        isUser ? 'bg-emerald-600' : 'bg-emerald-100 dark:bg-emerald-900/40'
      }`}>
        {isUser
          ? <User className="w-3.5 h-3.5 text-white" />
          : <Bot className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />}
      </div>

      <div className={`max-w-[78%] flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
        <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed shadow-sm ${
          isUser
            ? 'bg-emerald-600 text-white rounded-br-sm'
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
            className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 transition-colors"
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

const VoiceOrb: React.FC<{ state: VoiceState; onPress: () => void }> = ({ state, onPress }) => {
  const isInteractive = state === 'idle' || state === 'recording';
  const colorMap = {
    idle:       'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-400/30',
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
// Main Component
// ─────────────────────────────────────────────
export const FinSightChat: React.FC<FinSightChatProps> = ({ context, darkMode }) => {
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
  const [sessionId]             = useState(() => `finsight_${uid()}`);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef        = useRef<Blob[]>([]);
  const bottomRef        = useRef<HTMLDivElement>(null);
  const inputRef         = useRef<HTMLTextAreaElement>(null);
  const audioRef         = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef      = useRef<string | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, voiceState]);

  useEffect(() => {
    return () => {
      stopPlayback(audioRef, audioUrlRef);
    };
  }, []);

  const stopAudio = useCallback(() => {
    stopPlayback(audioRef, audioUrlRef);
    if (voiceState === 'speaking') setVoiceState('idle');
  }, [voiceState]);

  const playManagedAudio = useCallback(async (b64: string): Promise<void> => {
    stopPlayback(audioRef, audioUrlRef);

    return new Promise((resolve) => {
      try {
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        const blob = new Blob([bytes], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        audioUrlRef.current = url;

        audio.onended = () => {
          stopPlayback(audioRef, audioUrlRef);
          resolve();
        };

        audio.onerror = () => {
          stopPlayback(audioRef, audioUrlRef);
          resolve();
        };

        audio.play().catch(() => {
          stopPlayback(audioRef, audioUrlRef);
          resolve();
        });
      } catch {
        stopPlayback(audioRef, audioUrlRef);
        resolve();
      }
    });
  }, []);

  const handleToggleOpen = useCallback(() => {
    if (open) stopAudio();
    setOpen(v => !v);
  }, [open, stopAudio]);

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
          audit_context: context ?? null,
          context_type:  'finsight',
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
        text: stripThinkTags(data.assistant_message),
        audioBase64: data.audio_base64 ?? undefined,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, aMsg]);
      if (data.audio_base64) await playManagedAudio(data.audio_base64);
    } catch (e: any) {
      setError(e.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }, [input, loading, sessionId, context, language, textTTS]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); }
  };

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
      setError('Microphone access denied.');
    }
  };

  const stopAndProcess = useCallback(() => {
    const mr = mediaRecorderRef.current;
    if (!mr || mr.state === 'inactive') return;

    mr.onstop = async () => {
      mr.stream?.getTracks().forEach(t => t.stop());
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      if (blob.size < 500) {
        setVoiceState('idle');
        setError('Recording too short.');
        return;
      }

      setVoiceState('processing');
      const placeholderId = uid();
      setMessages(prev => [...prev, { id: placeholderId, role: 'user', text: 'Processing voice…', timestamp: new Date() }]);

      try {
        const form = new FormData();
        form.append('session_id',    sessionId);
        form.append('audio_file',    blob, 'voice.webm');
        form.append('language_code', language);
        form.append('enable_tts',    'true');
        form.append('context_type',  'finsight');
        if (context) form.append('audit_context', JSON.stringify(context));

        const res = await fetch(`${API_BASE}/api/chat/voice`, { method: 'POST', body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Error');

        setMessages(prev => prev.map(m => m.id === placeholderId ? { ...m, text: data.user_message } : m));
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
          await playManagedAudio(data.audio_base64);
        }
        setVoiceState('idle');
      } catch (e: any) {
        setMessages(prev => prev.filter(m => m.id !== placeholderId));
        setError('Voice failed.');
        setVoiceState('idle');
      }
    };
    mr.stop();
  }, [sessionId, language, context]);

  const handleOrbPress = useCallback(() => {
    if (voiceState === 'idle') {
      void startRecording();
      return;
    }
    if (voiceState === 'recording') {
      stopAndProcess();
    }
  }, [voiceState, stopAndProcess]);

  const clearSession = async () => {
    setMessages([]);
    setError(null);
    try { await fetch(`${API_BASE}/api/chat/session/${sessionId}`, { method: 'DELETE' }); } catch {}
  };

  const selectedLang = LANGUAGES.find(l => l.code === language) ?? LANGUAGES[0];

  return (
    <>
      <motion.button
        onClick={handleToggleOpen}
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.94 }}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-emerald-600 hover:bg-emerald-700 shadow-lg shadow-emerald-600/30 flex items-center justify-center transition-colors"
      >
        <AnimatePresence mode="wait">
          {open ? <motion.div key="x" animate={{ rotate: 0 }} initial={{ rotate: -90 }}><X className="w-6 h-6 text-white" /></motion.div> : <motion.div key="m" animate={{ rotate: 0 }} initial={{ rotate: 90 }}><Brain className="w-6 h-6 text-white" /></motion.div>}
        </AnimatePresence>
        {context && !open && <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-orange-500 rounded-full border-2 border-white animate-pulse" />}
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 24, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.95 }}
            className="fixed bottom-24 right-6 z-50 w-[360px] sm:w-[400px] h-[600px] flex flex-col rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 border-b border-white/10">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                  <Bot className="w-4 h-4 text-white" />
                </div>
                <div>
                  <p className="text-sm font-bold text-white">FinSight Coach</p>
                  <p className="text-[10px] text-emerald-100 flex items-center gap-1">
                    {context ? <><TrendingUp className="w-3 h-3" /> Analysis loaded</> : 'Your Financial Health Partner'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setLangOpen(!langOpen)} className="text-xs text-white bg-white/10 px-2 py-1 rounded-lg flex items-center gap-1">
                  <span>{selectedLang.flag}</span><ChevronDown className="w-3 h-3" />
                </button>
                <button onClick={clearSession} className="p-1.5 text-white/60 hover:text-white transition-colors"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>

            {/* Language Dropdown */}
            <AnimatePresence>
              {langOpen && (
                <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 overflow-hidden">
                  <div className="grid grid-cols-2 gap-1 p-2">
                    {LANGUAGES.map(l => (
                      <button key={l.code} onClick={() => { setLanguage(l.code); setLangOpen(false); }} className={`px-3 py-2 text-left text-xs rounded-lg transition-colors ${language === l.code ? 'bg-emerald-50 text-emerald-700 font-bold' : 'hover:bg-gray-50 text-gray-600'}`}>
                        {l.flag} {l.label}
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Tabs */}
            <div className="flex bg-gray-50 dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800">
              <button onClick={() => setTab('text')} className={`flex-1 py-2.5 text-xs font-bold transition-all ${tab === 'text' ? 'text-emerald-600 border-b-2 border-emerald-600' : 'text-gray-400'}`}>TEXT</button>
              <button onClick={() => setTab('voice')} className={`flex-1 py-2.5 text-xs font-bold transition-all ${tab === 'voice' ? 'text-emerald-600 border-b-2 border-emerald-600' : 'text-gray-400'}`}>VOICE</button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50/50 dark:bg-gray-950/20">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center gap-4 opacity-80">
                  <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/30 rounded-3xl flex items-center justify-center">
                    <Brain className="w-8 h-8 text-emerald-600" />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-800 dark:text-gray-100">Hi! I'm your FinSight Coach.</h3>
                    <p className="text-xs text-gray-500 mt-1 max-w-[240px]">I can help you understand your spending habits, improve your health score, and explain your investment plan.</p>
                  </div>
                  <div className="flex flex-col gap-2 w-full max-w-[280px]">
                    {['Why is my health score low?', 'How can I save ₹2000 more?', 'Explain my SIP suggestions'].map(q => (
                      <button key={q} onClick={() => setInput(q)} className="text-left px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-xs hover:border-emerald-300 transition-colors">{q}</button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map(m => <ChatBubble key={m.id} msg={m} onPlay={playManagedAudio} />)}
              {loading && <TypingIndicator />}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="p-3 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
              {tab === 'text' ? (
                <div className="flex gap-2">
                  <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown} placeholder="Ask your coach…" rows={1} className="flex-1 bg-gray-50 dark:bg-gray-800 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500/20" />
                  <button onClick={sendText} disabled={!input.trim() || loading} className="w-10 h-10 bg-emerald-600 text-white rounded-xl flex items-center justify-center disabled:opacity-40"><Send className="w-4 h-4" /></button>
                </div>
              ) : (
                <div className="flex flex-col items-center py-2 gap-3">
                  <VoiceOrb state={voiceState} onPress={handleOrbPress} />
                  <p className="text-[10px] text-gray-400">Powered by Sarvam AI Multilingual Voice</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
