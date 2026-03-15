import React from "react";
import { Moon, Sun, Menu, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { Link } from "react-router-dom";

const Docs: React.FC = () => {
    const [isDark, setIsDark] = React.useState(false);
    const [isMenuOpen, setIsMenuOpen] = React.useState(false);
    const faviconUrl = new URL("../assets/favicon.ico", import.meta.url).href;

    React.useEffect(() => {
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

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 text-gray-800 dark:text-gray-100 transition-colors duration-300">
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
                            to="/auth/sign-in"
                            className="px-4 py-2 text-sm font-semibold text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white transition"
                        >
                            Sign In
                        </Link>
                        <Link
                            to="/auth/sign-up"
                            className="px-4 py-2 bg-brand-600 hover:bg-brand-700 rounded-lg text-sm font-semibold text-white transition"
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
                        aria-controls="docs-mobile-menu"
                    >
                        {isMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                    </button>
                </div>

                {/* Mobile Navigation */}
                <AnimatePresence initial={false}>
                    {isMenuOpen && (
                        <motion.div
                            id="docs-mobile-menu"
                            className="md:hidden overflow-hidden"
                            initial={{ height: 0, opacity: 0, y: -6 }}
                            animate={{ height: "auto", opacity: 1, y: 0 }}
                            exit={{ height: 0, opacity: 0, y: -6 }}
                            transition={{ duration: 0.25, ease: "easeInOut" }}
                        >
                            <div className="flex flex-col gap-2 pt-1 pb-4 px-4">
                                <Link
                                    to="/auth/sign-in"
                                    className="w-full text-left px-3 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition"
                                    onClick={() => setIsMenuOpen(false)}
                                >
                                    Sign In
                                </Link>
                                <Link
                                    to="/auth/sign-up"
                                    className="w-full text-left px-3 py-2 rounded-lg text-sm font-semibold bg-brand-600 hover:bg-brand-700 text-white transition"
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

            <div className="max-w-5xl mx-auto space-y-12 px-4 sm:px-6 lg:px-8 py-12">
                {/* Title */}
                <section className="text-center space-y-4 rounded-2xl border border-gray-200/70 dark:border-gray-800/70 bg-white/70 dark:bg-gray-900/40 backdrop-blur-xl p-8">
                    <h1 className="text-4xl font-bold">
                        LoanGuard – AI Financial Guardian for Bharat
                    </h1>
                    <p className="text-lg text-gray-600 dark:text-gray-300">
                        AI-powered platform for financial growth optimization and loan compliance protection.
                    </p>
                </section>

                {/* 1. Problem Identification */}
                <section>
                    <h2 className="text-2xl font-semibold mb-4">
                        1. Problem Identification & Clarity
                    </h2>

                    <h3 className="text-xl font-medium mt-4">Low Financial Literacy</h3>
                    <ul className="list-disc ml-6 mt-2 space-y-1">
                        <li>Lack of structured budgeting tools in Tier-2 & Tier-3 regions</li>
                        <li>Poor understanding of EMI, compound interest, and penal charges</li>
                        <li>Limited access to multilingual financial education</li>
                    </ul>

                    <h3 className="text-xl font-medium mt-6">Unfair Loan Practices</h3>
                    <ul className="list-disc ml-6 mt-2 space-y-1">
                        <li>Hidden processing fees and excessive penalty clauses</li>
                        <li>Illegal compounding of penal interest</li>
                        <li>Lack of awareness about grievance redressal rights</li>
                    </ul>

                    <p className="mt-6 font-medium text-gray-700 dark:text-gray-300">
                        Core Gap: No unified AI system combines financial advisory with regulatory protection.
                    </p>
                </section>

                {/* 2. Solution Overview */}
                <section>
                    <h2 className="text-2xl font-semibold mb-4">
                        2. Solution Overview
                    </h2>

                    <p className="mb-6 text-gray-700 dark:text-gray-300">
                        FinShield is a dual-engine AI platform that enables users to optimize
                        financial decisions while protecting themselves from unfair lending practices.
                    </p>

                    <div className="grid md:grid-cols-2 gap-8">
                        <div className="border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 rounded-xl p-6 shadow-sm">
                            <h3 className="text-xl font-semibold mb-3">
                                Module 1: FinShield Advisor – Financial Growth Engine
                            </h3>
                            <ul className="list-disc ml-6 space-y-1">
                                <li>Income & expense tracking</li>
                                <li>Smart budget optimization</li>
                                <li>SIP & insurance recommendations</li>
                                <li>Emergency fund planning</li>
                                <li>Debt-to-income monitoring</li>
                                <li>Multilingual financial education</li>
                            </ul>
                        </div>

                        <div className="border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 rounded-xl p-6 shadow-sm">
                            <h3 className="text-xl font-semibold mb-3">
                                Module 2: FinShield LoanGuard – Financial Protection Engine
                            </h3>
                            <ul className="list-disc ml-6 space-y-1">
                                <li>Loan PDF data extraction</li>
                                <li>EMI recalculation engine</li>
                                <li>Hidden charge detection</li>
                                <li>RBI compliance verification</li>
                                <li>Risk score (0–100)</li>
                                <li>Automated escalation letter generation</li>
                            </ul>
                        </div>
                    </div>
                </section>

                {/* 3. System Architecture */}
                <section>
                    <h2 className="text-2xl font-semibold mb-4">
                        3. System Architecture
                    </h2>

                    <ul className="list-disc ml-6 space-y-1">
                        <li>User Interface Layer (Chatbot, Dashboard, Loan Upload)</li>
                        <li>AI Processing Layer (NLP, EMI Engine, Risk Scoring)</li>
                        <li>Advisor & LoanGuard Engines</li>
                        <li>Report & Financial Plan Output</li>
                    </ul>
                </section>

                {/* 4. Technology Stack */}
                <section>
                    <h2 className="text-2xl font-semibold mb-4">
                        4. Technology Stack
                    </h2>

                    <ul className="list-disc ml-6 space-y-1">
                        <li>Frontend: React / Next.js</li>
                        <li>Backend: Node.js / Python</li>
                        <li>AI/NLP: LLM APIs</li>
                        <li>OCR: Tesseract / PDF Parsing Libraries</li>
                        <li>Database: PostgreSQL</li>
                    </ul>
                </section>

                {/* 5. Feasibility & Scalability */}
                <section>
                    <h2 className="text-2xl font-semibold mb-4">
                        5. Feasibility & Scalability
                    </h2>

                    <h3 className="text-xl font-medium mt-4">MVP Feasibility</h3>
                    <ul className="list-disc ml-6 mt-2 space-y-1">
                        <li>Basic financial chatbot</li>
                        <li>EMI recalculation module</li>
                        <li>Loan PDF parsing</li>
                        <li>Static RBI rule validation</li>
                        <li>Risk scoring system</li>
                    </ul>

                    <h3 className="text-xl font-medium mt-6">Scalability</h3>
                    <ul className="list-disc ml-6 mt-2 space-y-1">
                        <li>Regional language expansion</li>
                        <li>Bank & NBFC API integration</li>
                        <li>MSME loan auditing</li>
                        <li>Mobile application deployment</li>
                    </ul>
                </section>

                {/* 6. Impact */}
                <section>
                    <h2 className="text-2xl font-semibold mb-4">
                        6. Impact & Competitive Advantage
                    </h2>

                    <ul className="list-disc ml-6 space-y-1">
                        <li>Reduced unfair EMI burden</li>
                        <li>Improved monthly savings</li>
                        <li>Higher financial literacy</li>
                        <li>Integrated advisory + compliance system</li>
                    </ul>

                    <p className="mt-6 font-semibold text-center text-gray-800 dark:text-gray-100">
                        FinShield democratizes financial intelligence and borrower protection.
                    </p>
                </section>
            </div>
        </div>
    );
};

export default Docs;