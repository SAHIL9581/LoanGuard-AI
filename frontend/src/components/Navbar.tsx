import React from 'react';
import { Moon, Sun, Menu, X, LogOut, Languages, ChevronDown } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

interface LangOption {
  code: string;
  label: string;
}

interface Props {
  darkMode: boolean;
  toggleDark: () => void;
  showReset?: boolean;
  onReset?: () => void;
  onMobileHamburgerClick?: () => void;
  useMobileActionsMenu?: boolean;
  /* New: global controls moved from sidebar */
  languages?: LangOption[];
  currentLang?: LangOption;
  onLangChange?: (code: string) => void;
  onLogout?: () => void;
}

export const Navbar: React.FC<Props> = ({
  darkMode,
  toggleDark,
  showReset,
  onReset,
  onMobileHamburgerClick,
  useMobileActionsMenu = true,
  languages = [],
  currentLang,
  onLangChange,
  onLogout,
}) => {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [langDropOpen, setLangDropOpen] = React.useState(false);
  const langRef = React.useRef<HTMLDivElement>(null);
  const faviconUrl = new URL('../assets/favicon.ico', import.meta.url).href;

  // Close lang dropdown on outside click
  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) {
        setLangDropOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleHamburgerClick = () => {
    if (onMobileHamburgerClick) {
      onMobileHamburgerClick();
      return;
    }
    setMobileOpen((prev) => !prev);
  };

  const showLanguagePicker = languages.length > 0 && onLangChange && currentLang;

  return (
    <nav className="sticky top-0 z-50 bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl border-b border-gray-200/60 dark:border-gray-800/60 transition-colors duration-300 shadow-sm">
      <div className="w-full mx-auto px-4 sm:px-6 lg:px-8">
        <div className="h-16 flex items-center justify-between gap-4">
          {/* ── Logo ─────────────────────────────── */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center overflow-hidden">
              <img src={faviconUrl} alt="LoanGuard" className="w-7 h-7 object-contain" />
            </div>
            <p className="text-xl font-black text-gray-900 dark:text-white tracking-tight">LoanGuard</p>
          </div>

          {/* ── Desktop Actions ───────────────────── */}
          <div className="hidden md:flex items-center gap-2">
            {showReset && onReset && (
              <button
                onClick={onReset}
                className="px-4 py-2 text-sm font-semibold text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition"
              >
                New Analysis
              </button>
            )}

            {/* Language dropdown */}
            {showLanguagePicker && (
              <div className="relative" ref={langRef}>
                <button
                  id="lang-switcher"
                  onClick={() => setLangDropOpen((v) => !v)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
                  aria-label="Switch language"
                >
                  <Languages className="w-4 h-4" />
                  <span>{currentLang.label}</span>
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${langDropOpen ? 'rotate-180' : ''}`} />
                </button>
                <AnimatePresence>
                  {langDropOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -6, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6, scale: 0.96 }}
                      transition={{ duration: 0.15 }}
                      className="absolute right-0 mt-2 w-40 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl shadow-black/10 overflow-hidden z-50"
                    >
                      {languages.map((l) => (
                        <button
                          key={l.code}
                          onClick={() => { onLangChange!(l.code); setLangDropOpen(false); }}
                          className={`w-full flex items-center gap-2 px-4 py-2.5 text-sm transition-colors text-left ${
                            currentLang.code === l.code
                              ? 'bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 font-semibold'
                              : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800'
                          }`}
                        >
                          {currentLang.code === l.code && (
                            <span className="w-1.5 h-1.5 rounded-full bg-brand-500 flex-shrink-0" />
                          )}
                          <span className={currentLang.code !== l.code ? 'ml-3.5' : ''}>{l.label}</span>
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* Dark mode toggle */}
            <button
              type="button"
              onClick={toggleDark}
              aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              className="w-10 h-10 inline-flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white transition"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            {/* Logout */}
            {onLogout && (
              <button
                onClick={onLogout}
                aria-label="Logout"
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 hover:border-red-200 dark:hover:border-red-800 transition"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden lg:inline">Logout</span>
              </button>
            )}
          </div>

          {/* ── Mobile Hamburger ──────────────────────────────── */}
          <button
            type="button"
            onClick={handleHamburgerClick}
            aria-label="Toggle navigation menu"
            aria-expanded={onMobileHamburgerClick ? undefined : mobileOpen}
            aria-controls="mobile-navbar-menu"
            className="md:hidden inline-flex items-center justify-center w-10 h-10 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* ── Mobile dropdown menu ───────────────────────────────────────── */}
        {useMobileActionsMenu && (
          <AnimatePresence initial={false}>
            {mobileOpen && (
              <motion.div
                id="mobile-navbar-menu"
                className="md:hidden overflow-hidden"
                initial={{ height: 0, opacity: 0, y: -6 }}
                animate={{ height: 'auto', opacity: 1, y: 0 }}
                exit={{ height: 0, opacity: 0, y: -6 }}
                transition={{ duration: 0.22, ease: 'easeInOut' }}
              >
                <div className="flex flex-col gap-2 pt-1 pb-4">
                  {showReset && onReset && (
                    <button
                      onClick={() => { onReset(); setMobileOpen(false); }}
                      className="w-full text-left px-3 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition"
                    >
                      New Analysis
                    </button>
                  )}

                  {/* Language select (mobile) */}
                  {showLanguagePicker && (
                    <div className="px-1">
                      <p className="text-xs text-gray-400 mb-1 px-2">Language</p>
                      <div className="grid grid-cols-2 gap-1.5">
                        {languages.map((l) => (
                          <button
                            key={l.code}
                            onClick={() => { onLangChange!(l.code); setMobileOpen(false); }}
                            className={`px-3 py-2 rounded-lg text-sm font-medium text-left transition ${
                              currentLang!.code === l.code
                                ? 'bg-brand-500 text-white'
                                : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700'
                            }`}
                          >
                            {l.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Dark mode */}
                  <button
                    type="button"
                    onClick={() => { toggleDark(); setMobileOpen(false); }}
                    aria-label="Toggle theme"
                    className="w-full inline-flex items-center gap-2 rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
                  >
                    {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                    {darkMode ? 'Light Mode' : 'Dark Mode'}
                  </button>

                  {/* Logout */}
                  {onLogout && (
                    <button
                      onClick={() => { onLogout(); setMobileOpen(false); }}
                      className="w-full inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm font-semibold text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition"
                    >
                      <LogOut className="w-4 h-4" /> Logout
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>
    </nav>
  );
};
