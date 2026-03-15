import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Shield, ArrowRight, CheckCircle, Zap, Search, AlertTriangle, Mail, Brain, Moon, Sun, Menu, X } from "lucide-react";
import { Link } from "react-router-dom";

export default function Landing() {
  const [isDark, setIsDark] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const faviconUrl = new URL('../assets/favicon.ico', import.meta.url).href;

  useEffect(() => {
    const root = document.documentElement;
    const stored = localStorage.getItem("theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const nextDark = stored ? stored === "dark" : root.classList.contains("dark") || prefersDark;

    root.classList.toggle("dark", nextDark);
    setIsDark(nextDark);
  }, []);

  const toggleTheme = () => {
    const root = document.documentElement;
    const nextDark = !isDark;
    root.classList.toggle("dark", nextDark);
    localStorage.setItem("theme", nextDark ? "dark" : "light");
    setIsDark(nextDark);
  };

  const features = [
    {
      icon: Shield,
      label: "Risk Scoring Engine",
      desc: "Get a comprehensive risk score across 7 dimensions: EMI deviation, hidden fees, RBI violations, penal stacking, transparency, ambiguity, and behavioral risks."
    },
    {
      icon: Search,
      label: "Loan Document Analysis",
      desc: "Automatic extraction of loan terms, EMI calculations, processing fees, and key facts statement verification from your PDF agreement."
    },
    {
      icon: AlertTriangle,
      label: "Violation Detection",
      desc: "Identify all regulatory breaches against RBI guidelines, deterministic violations, and predatory clauses with severity levels."
    },
    {
      icon: Zap,
      label: "EMI Verification",
      desc: "Detect overcharges by comparing expected vs. stated EMI. Identifies mathematical discrepancies and hidden fee stacking."
    },
    {
      icon: Brain,
      label: "Behavioral Risk Analysis",
      desc: "Detect threat language, aggressive tone, consent misuse, and data abuse clauses in your loan agreement."
    },
    {
      icon: Mail,
      label: "Escalation Letters",
      desc: "Generate pre-drafted complaint letters at 3 escalation levels—ready to send to your bank or regulatory bodies."
    },
  ];

  return (
    <div className="relative min-h-screen bg-gradient-to-br from-red-50 via-white to-orange-50 dark:from-gray-950 dark:via-red-950/20 dark:to-gray-950 text-gray-900 dark:text-white transition-colors duration-300">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border-b border-gray-200/50 dark:border-gray-800/50 transition-colors duration-300">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center overflow-hidden">
              <img src={faviconUrl} alt="LoanGuard" className="w-6 h-6 object-contain" />
            </div>
            <Link to="/" className="text-xl font-black">LoanGuard</Link>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-4">
            <Link
              to="/docs"
              className="px-4 py-2 text-sm font-semibold text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white transition"
            >
              Docs
            </Link>
            <Link
              to="/auth/sign-up"
              className="px-4 py-2 bg-red-600 text-white hover:bg-red-700 rounded-lg text-sm font-semibold transition"
            >
              Get Started
            </Link>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle theme"
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              {isDark ? "Light" : "Dark"}
            </button>
          </div>

          {/* Mobile Menu Button */}
          <button
            type="button"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="md:hidden inline-flex items-center justify-center w-10 h-10 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
            aria-label="Toggle menu"
            aria-expanded={isMenuOpen}
            aria-controls="landing-mobile-menu"
          >
            {isMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* Mobile Navigation */}
        <AnimatePresence initial={false}>
          {isMenuOpen && (
            <motion.div
              id="landing-mobile-menu"
              className="md:hidden overflow-hidden"
              initial={{ height: 0, opacity: 0, y: -6 }}
              animate={{ height: "auto", opacity: 1, y: 0 }}
              exit={{ height: 0, opacity: 0, y: -6 }}
              transition={{ duration: 0.25, ease: "easeInOut" }}
            >
              <div className="flex flex-col gap-2 pt-1 pb-4 px-4">
                <Link
                  to="/docs"
                  className="w-full text-left px-3 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition"
                  onClick={() => setIsMenuOpen(false)}
                >
                  Docs
                </Link>

                <Link
                  to="/auth/sign-up"
                  className="w-full text-left px-3 py-2 rounded-lg text-sm font-semibold bg-red-600 hover:bg-red-700 text-white transition"
                  onClick={() => setIsMenuOpen(false)}
                >
                  Get Started
                </Link>

                <button
                  type="button"
                  onClick={() => {
                    toggleTheme();
                    setIsMenuOpen(false);
                  }}
                  className="w-full inline-flex items-center gap-2 rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
                >
                  {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                  {isDark ? "Light" : "Dark"}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </nav>

      <section className="relative w-full min-h-[calc(100vh-4rem)] flex items-center overflow-hidden">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-24 -left-20 h-72 w-72 rounded-full bg-red-400/25 dark:bg-red-500/20 blur-3xl" />
          <div className="absolute -bottom-24 -right-20 h-72 w-72 rounded-full bg-orange-400/25 dark:bg-orange-500/20 blur-3xl" />
          <div className="absolute inset-0 opacity-[0.35] dark:opacity-[0.18] [background-image:linear-gradient(to_right,#94a3b81f_1px,transparent_1px),linear-gradient(to_bottom,#94a3b81f_1px,transparent_1px)] [background-size:28px_28px]" />
        </div>

        {/* Content */}
        <div className="relative z-10 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="grid lg:grid-cols-2 gap-10 items-center">
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55 }}
            >
              <span className="inline-flex items-center rounded-full border border-red-300/70 dark:border-red-700/70 dark:text-white bg-red-50/80 dark:bg-red-900/20 px-3 py-1 text-xs font-semibold text-red-700 dark:text-red-300">
                Loan Audit + Risk Intelligence
              </span>

              <h1 className="mt-5 font-sans text-4xl sm:text-5xl lg:text-6xl font-black leading-[1.03] tracking-tight text-gray-900 dark:text-white">
                Audit Your Loan{" "}
                <span className="px-1 font-serif italic bg-gradient-to-r from-red-500 to-orange-500 bg-clip-text text-transparent">
                  for Hidden Risks
                </span>{" "}
                & Unfair Terms
              </h1>

              <p className="mt-5 text-base sm:text-lg text-gray-600 dark:text-gray-300 max-w-xl leading-relaxed">
                LoanGuard analyzes your loan agreement against RBI guidelines, detects regulatory violations, flags overcharges, and identifies predatory clauses—all with industry-backed risk scoring.
              </p>

              <div className="mt-8 flex items-center gap-3 flex-wrap">
                <Link
                  to="/auth/sign-up"
                  className="px-6 py-3 bg-red-600 hover:bg-red-700 rounded-xl font-semibold flex items-center gap-2 text-white shadow-lg shadow-red-500/20 transition"
                >
                  Start Free Analysis
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <Link
                  to="/auth/sign-in"
                  className="px-6 py-3 rounded-xl border border-gray-300/80 dark:border-gray-700 text-gray-800 dark:text-white hover:bg-gray-100/70 dark:hover:bg-gray-800/70 font-semibold transition"
                >
                  Sign In
                </Link>
              </div>

              <div className="mt-6 flex flex-wrap gap-2 text-xs sm:text-sm">
                <span className="px-3 py-1 rounded-full bg-white/80 dark:bg-gray-800/70 border border-gray-200 dark:border-gray-700">Loan document analysis</span>
                <span className="px-3 py-1 rounded-full bg-white/80 dark:bg-gray-800/70 border border-gray-200 dark:border-gray-700">Violation detection</span>
                <span className="px-3 py-1 rounded-full bg-white/80 dark:bg-gray-800/70 border border-gray-200 dark:border-gray-700">Escalation workflows</span>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 14 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.1 }}
              className="relative"
            >
              <div className="rounded-2xl border border-gray-200/80 dark:border-gray-700/70 bg-white/80 dark:bg-gray-900/70 backdrop-blur-xl p-5 sm:p-6 shadow-2xl shadow-gray-900/5 dark:shadow-black/20">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-800/60 p-4">
                    <p className="text-xs text-gray-500 dark:text-gray-400">Risk Detection Rate</p>
                    <p className="text-2xl font-black mt-1">98.2%</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-800/60 p-4">
                    <p className="text-xs text-gray-500 dark:text-gray-400">Avg. Overcharge Found</p>
                    <p className="text-2xl font-black mt-1">₹12k+</p>
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-800/60 px-3 py-2 text-sm">✓ EMI overcharge detection</div>
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-800/60 px-3 py-2 text-sm">✓ RBI violation flagging</div>
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-800/60 px-3 py-2 text-sm">✓ Complaint letter generation</div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <h2 className="text-3xl font-black text-center mb-12">Powerful Features</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f, i) => {
            const Icon = f.icon;
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className="bg-white border border-gray-200 dark:bg-white/5 dark:border-gray-700/50 rounded-xl p-6 hover:bg-red-50/30 dark:hover:bg-red-900/10 transition"
              >
                <Icon className="w-8 h-8 text-red-500 dark:text-red-400 mb-3" />
                <h3 className="font-bold mb-2 text-lg">{f.label}</h3>
                <p className="text-gray-600 dark:text-gray-400 text-sm">{f.desc}</p>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* Benefits */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <h2 className="text-3xl font-black text-center mb-12">Why Choose LoanGuard?</h2>
        <div className="space-y-4 max-w-2xl mx-auto">
          {[
            "RBI-compliant analysis powered by official regulatory guidelines",
            "Detects overcharges, unfair clauses, and hidden terms instantly",
            "Industry-backed risk scoring with appeal success probability",
            "Generate multi-level escalation letters ready to file",
            "Privacy-first: Your documents never leave your device",
          ].map((benefit, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.1 }}
              className="flex items-center gap-3 text-lg text-gray-700 dark:text-gray-200"
            >
              <CheckCircle className="w-5 h-5 text-green-500 dark:text-green-400 flex-shrink-0" />
              {benefit}
            </motion.div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="bg-gradient-to-r from-red-600 to-orange-600 rounded-2xl p-12"
        >
          <h2 className="text-5xl text-white font-bold mb-4">
            Protect Your Loan Rights Today
          </h2>
          <p className="text-gray-100 mb-6 max-w-xl mx-auto">
            Audit your loan, detect violations, and build your case with LoanGuard.
          </p>
          <Link
            to="/auth/sign-up"
            className="inline-block px-8 py-3 bg-white text-red-600 rounded-lg font-bold hover:bg-gray-100 transition"
          >
            Get Started Now
          </Link>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-200 dark:border-gray-700/50 mt-20 py-12 text-center text-gray-500 dark:text-gray-400 text-sm">
        <p>LoanGuard · Comprehensive Loan Audit & Risk Intelligence ·</p>
      </footer>
    </div>
  );
}