import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Dashboard } from './pages/Dashboard';
import Landing from './pages/Landing';
import SignIn from './pages/auth/SignIn';
import SignUp from './pages/auth/SignUp';
import Docs from './pages/Docs';
import { LoanGuard } from './pages/dashboard/LoanGuard';
import { FinSip } from './pages/dashboard/FinSip';
import { FinSight } from './pages/dashboard/FinSight';

const App: React.FC = () => {
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    const stored = localStorage.getItem('theme');
    if (stored) return stored === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [darkMode]);

  const toggleDark = () => setDarkMode(!darkMode);

  return (
    <>
      <Router>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/auth/sign-in" element={<SignIn />} />
          <Route path="/auth/sign-up" element={<SignUp />} />
          <Route
            path="/dashboard"
            element={<Dashboard darkMode={darkMode} toggleDark={toggleDark} />}
          />
          <Route path="/docs" element={<Docs />} />
          <Route path="/dashboard/loanguard" element={<LoanGuard darkMode={darkMode} toggleDark={toggleDark} />} />
          <Route path="/dashboard/finsip" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard/finsight" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </>
  );
};

export default App;