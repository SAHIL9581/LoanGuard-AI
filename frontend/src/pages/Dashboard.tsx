import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Zap, Search, FileText, TrendingUp, Mail, Brain, Shield,
  ArrowRight, LayoutDashboard, Clock3, ChevronRight,
  X, PlayCircle, BarChart2, Activity
} from 'lucide-react';
import { Navbar } from '../components/Navbar';
import { Sidebar } from '../components/Sidebar';
import { Link, useNavigate } from 'react-router-dom';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { authService } from '../services/authService';
import { useTranslation } from 'react-i18next';
import Joyride, { CallBackProps, STATUS, Step } from 'react-joyride';

interface Props {
  darkMode: boolean;
  toggleDark: () => void;
}

export const Dashboard: React.FC<Props> = ({ darkMode, toggleDark }) => {
  const { t, i18n } = useTranslation();
  const [now, setNow] = useState(new Date());
  const [displayName, setDisplayName] = useState('there');
  const navigate = useNavigate();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Joyride State
  const [runTour, setRunTour] = useState(false);
  const tourSteps = React.useMemo<Step[]>(() => [
    {
      target: 'body',
      placement: 'center',
      content: (
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">{t('tour.step1.title')}</h2>
          <p className="text-gray-600">{t('tour.step1.content')}</p>
        </div>
      ),
      disableBeacon: true,
    },
    {
      target: '#loanguard-card',
      content: (
        <div>
          <h3 className="font-bold mb-1">{t('tour.step2.title')}</h3>
          <p className="text-sm">{t('tour.step2.content')}</p>
        </div>
      ),
    },
    {
      target: '#lang-switcher',
      content: (
        <div>
          <h3 className="font-bold mb-1">{t('tour.step4.title')}</h3>
          <p className="text-sm">{t('tour.step4.content')}</p>
        </div>
      )
    }
  ], [t]);

  useEffect(() => {
    // Check if user has seen tour
    const hasSeenTour = localStorage.getItem('hasSeenDashboardTour');
    if (!hasSeenTour) {
      setRunTour(true);
    }
  }, []);

  const handleJoyrideCallback = (data: CallBackProps) => {
    const { status } = data;
    const finishedStatuses: string[] = [STATUS.FINISHED, STATUS.SKIPPED];

    if (finishedStatuses.includes(status)) {
      setRunTour(false);
      localStorage.setItem('hasSeenDashboardTour', 'true');
    }
  };

  const startTour = () => setRunTour(true);

  const LANGUAGES = [
    { code: 'en', label: 'English' },
    { code: 'hi', label: 'हिंदी (Hindi)' },
    { code: 'te', label: 'తెలుగు (Telugu)' },
    { code: 'ml', label: 'മലയാളം (Malayalam)' },
    { code: 'ta', label: 'தமிழ் (Tamil)' },
  ];

  const currentLang = LANGUAGES.find(l => l.code === i18n.language) || LANGUAGES[0];

  const toggleLanguage = () => {
    const currentIndex = LANGUAGES.findIndex(l => l.code === i18n.language);
    const nextIndex = (currentIndex + 1) % LANGUAGES.length;
    i18n.changeLanguage(LANGUAGES[nextIndex].code);
  };

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const auth = getAuth();
    const unsub = onAuthStateChanged(auth, (user) => {
      const fallbackRaw =
        localStorage.getItem('userName') ||
        localStorage.getItem('displayName') ||
        localStorage.getItem('email') ||
        localStorage.getItem('userEmail') || '';
      const fallback = fallbackRaw.includes('@') ? fallbackRaw.split('@')[0] : fallbackRaw;
      setDisplayName(
        user?.displayName || (user?.email ? user.email.split('@')[0] : '') || fallback || 'there'
      );
    });
    return () => unsub();
  }, []);

  const getGreetingKey = () => {
    const hour = now.getHours();
    if (hour < 12) return 'greeting.morning';
    if (hour < 18) return 'greeting.afternoon';
    return 'greeting.evening';
  }

  const displayTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const displayDate = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

  const handleLogout = async () => {
    try {
      await authService.logout();
      localStorage.removeItem('authToken');
      navigate('/');
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 transition-colors duration-300 lg:h-screen lg:overflow-hidden">
      <Joyride
        steps={tourSteps}
        run={runTour}
        continuous
        showProgress
        showSkipButton
        callback={handleJoyrideCallback}
        styles={{
          options: {
            primaryColor: '#0ea5e9', // brand-500
            zIndex: 1000,
          },
          tooltip: {
            borderRadius: '16px',
            padding: '24px'
          }
        }}
      />
      <Navbar
        darkMode={darkMode}
        toggleDark={toggleDark}
        showReset={false}
        onReset={() => { }}
        onMobileHamburgerClick={() => setMobileSidebarOpen(true)}
        useMobileActionsMenu={false}
        languages={LANGUAGES}
        currentLang={currentLang}
        onLangChange={(code) => i18n.changeLanguage(code)}
        onLogout={handleLogout}
      />

      {/* ── Mobile Sidebar ── */}
      <AnimatePresence>
        {mobileSidebarOpen && (
          <motion.div
            className="fixed inset-0 z-[60] lg:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div
              className="absolute inset-0 top-16 bg-black/40"
              onClick={() => setMobileSidebarOpen(false)}
            />
            <motion.aside
              initial={{ x: -320 }}
              animate={{ x: 0 }}
              exit={{ x: -320 }}
              transition={{ duration: 0.25, ease: 'easeInOut' }}
              className="absolute left-0 top-16 h-[calc(100vh-4rem)] w-[85%] max-w-xs bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col"
            >
              <div className="p-4 flex flex-col h-full overflow-hidden">
                <Sidebar
                  displayTime={displayTime}
                  onReplayTour={() => setRunTour(true)}
                  isCurrentPage="dashboard"
                  onMobileClose={() => setMobileSidebarOpen(false)}
                  isMobile={true}
                />
              </div>
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Main Layout ── */}
      <main className="w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:h-[calc(100vh-4rem)] lg:py-6 lg:overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:h-full">

          {/* ── Sidebar ── */}
          <aside className="hidden lg:block lg:col-span-3 lg:sticky lg:top-0 lg:h-full">
            <Sidebar
              displayTime={displayTime}
              onReplayTour={() => setRunTour(true)}
              isCurrentPage="dashboard"
            />
          </aside>

          {/* ── Content ── */}
          <section className="lg:col-span-9 space-y-6 lg:h-full lg:overflow-y-auto lg:pr-1 lg:[scrollbar-width:none] lg:[-ms-overflow-style:none] lg:[&::-webkit-scrollbar]:hidden">

            {/* Greeting */}
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-gradient-to-br from-white to-gray-50 dark:from-gray-900 dark:to-gray-800/50 p-6 shadow-sm relative overflow-hidden"
            >
              {/* Decorative faint pattern */}
              <div className="absolute -right-16 -top-16 w-64 h-64 bg-brand-500/5 dark:bg-brand-500/10 rounded-full blur-3xl" />

              <h1 className="text-3xl font-black text-gray-900 dark:text-white tracking-tight relative z-10">
                {t(getGreetingKey())}, <span className="text-brand-600 dark:text-brand-400">{displayName}</span>
              </h1>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400 font-medium relative z-10">
                {displayDate} · {displayTime}
              </p>
            </motion.div>

            {/* Product Cards — 2 columns only for the two product cards */}
            <div className="grid grid-cols-1 gap-6">
              {/* LoanGuard */}
              <Link to="/dashboard/loanguard" id="loanguard-card">
                <motion.div
                  whileHover={{ y: -4, scale: 1.01 }}
                  transition={{ type: "spring", stiffness: 300 }}
                  className="bg-white dark:bg-gray-800 rounded-2xl p-8 border-2 border-brand-200 dark:border-brand-800 hover:border-brand-500 dark:hover:border-brand-500 hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all cursor-pointer text-left group h-full relative overflow-hidden"
                >
                  <div className="absolute top-0 left-0 w-1 h-full bg-brand-500" />
                  <div className="flex items-start justify-between mb-4">
                    <div className="p-3 bg-brand-50 dark:bg-brand-900/40 rounded-xl group-hover:scale-110 transition-transform">
                      <Shield className="w-8 h-8 text-brand-600 dark:text-brand-400" />
                    </div>
                    <ArrowRight className="w-6 h-6 text-gray-300 dark:text-gray-600 group-hover:text-brand-500 group-hover:translate-x-2 transition-all" />
                  </div>
                  <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{t('dashboard.loanguard.title')}</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-6 leading-relaxed">
                    {t('dashboard.loanguard.desc')}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { icon: Zap, label: t('dashboard.loanguard.feature1') },
                      { icon: Search, label: t('dashboard.loanguard.feature2') },
                      { icon: FileText, label: t('dashboard.loanguard.feature3') },
                    ].map((f, i) => {
                      const IconComponent = f.icon;
                      return (
                        <span
                          key={i}
                          className="text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 px-2.5 py-1.5 rounded-md flex items-center gap-1.5 font-medium"
                        >
                          <IconComponent className="w-3.5 h-3.5 text-brand-500" /> {f.label}
                        </span>
                      );
                    })}
                  </div>
                </motion.div>
              </Link>

            </div>

            {/* Dashboard UI Footer */}
            <footer className="border-t border-gray-200 dark:border-gray-800 mt-16 py-6 lg:hidden">
              <div className="w-full mx-auto px-4 text-center text-xs text-gray-400 dark:text-gray-600">
                {t('dashboard.footer', 'LoanGuard · Built for Indian consumers · Powered by OpenAI · Not a substitute for professional legal advice')}
              </div>
            </footer>

            {/* Feature Pills */}
            <div className="flex flex-wrap gap-3 pb-8">
              {[
                { icon: Brain, label: t('dashboard.features.ai') },
                { icon: Mail, label: t('dashboard.features.letters') },
                { icon: TrendingUp, label: t('dashboard.features.risk') },
                { icon: FileText, label: t('dashboard.features.reports') },
                { icon: Search, label: t('dashboard.features.clause') },
                { icon: Zap, label: t('dashboard.features.emi') },
              ].map((f, i) => {
                const IconComponent = f.icon;
                return (
                  <motion.span
                    whileHover={{ scale: 1.05, y: -2 }}
                    key={i}
                    className="text-xs bg-white dark:bg-gray-800 border-b-2 border-gray-200 dark:border-gray-700 hover:border-brand-400 dark:hover:border-brand-500 text-gray-600 dark:text-gray-300 px-4 py-2 rounded-xl shadow-sm hover:shadow flex items-center gap-2 font-medium transition-colors cursor-default"
                  >
                    <IconComponent className="w-4 h-4 text-brand-500 opacity-80" /> {f.label}
                  </motion.span>
                );
              })}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
};

