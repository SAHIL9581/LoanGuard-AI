import React from 'react';
import { motion } from 'framer-motion';
import {
  LayoutDashboard, Shield, ChevronRight,
  Clock3, PlayCircle, X
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

interface SidebarProps {
  displayTime: string;
  onReplayTour: () => void;
  isCurrentPage?: 'dashboard' | 'loanguard' | 'finsip' | 'finsight';
  onMobileClose?: () => void;
  isMobile?: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  displayTime,
  onReplayTour,
  isCurrentPage = 'dashboard',
  onMobileClose,
  isMobile = false,
}) => {
  const { t } = useTranslation();

  const pages = [
    {
      id: 'dashboard',
      label: t('dashboard.dashboard', 'Dashboard'),
      icon: LayoutDashboard,
      path: '/dashboard',
    },
    {
      id: 'loanguard',
      label: t('dashboard.loanguard.title', 'LoanGuard'),
      icon: Shield,
      path: '/dashboard/loanguard',
    },

  ];

  const handleNavClick = () => {
    if (isMobile && onMobileClose) {
      onMobileClose();
    }
  };

  return (
    <div className="h-full rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm flex flex-col overflow-hidden">
      {/* Mobile close button */}
      {isMobile && (
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {t('dashboard.workspace', 'Workspace')}
          </p>
          <button
            onClick={onMobileClose}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X className="w-5 h-5 dark:text-white" />
          </button>
        </div>
      )}

      {/* Desktop workspace label */}
      {!isMobile && (
        <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">
          {t('dashboard.workspace', 'Workspace')}
        </p>
      )}

      {/* Navigation Links */}
      <div className="space-y-2">
        {pages.map((page) => {
          const IconComponent = page.icon;
          const isActive = isCurrentPage === page.id;

          if (isActive) {
            return (
              <div
                key={page.id}
                className="flex items-center justify-between rounded-lg bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 px-3 py-2 shadow-[0_0_15px_rgba(14,165,233,0.1)]"
              >
                <span className="text-sm font-semibold text-brand-700 dark:text-brand-300 inline-flex items-center gap-2">
                  <IconComponent className="w-4 h-4" /> {page.label}
                </span>
                <ChevronRight className="w-4 h-4 text-brand-500" />
              </div>
            );
          }

          return (
            <Link
              key={page.id}
              to={page.path}
              onClick={handleNavClick}
              className="flex items-center justify-between rounded-lg px-3 py-2 border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition group"
            >
              <span className="text-sm text-gray-700 dark:text-gray-200 inline-flex items-center gap-2 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">
                <IconComponent className="w-4 h-4" /> {page.label}
              </span>
              <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300" />
            </Link>
          );
        })}
      </div>

      {/* Bottom Section */}
      <div className="mt-auto">
        {/* Time Display */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40 p-3">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
            {t('dashboard.local_time', 'Local time')}
          </p>
          <p className="text-sm font-semibold text-gray-900 dark:text-white inline-flex items-center gap-2">
            <Clock3 className="w-4 h-4" /> {displayTime}
          </p>
        </div>

        {/* Replay Tutorial Button */}
        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-800">
          <button
            onClick={() => {
              onReplayTour();
              handleNavClick();
            }}
            className="w-full inline-flex items-center justify-center gap-2 text-sm text-brand-600 dark:text-brand-400 px-3 py-2 rounded-lg border border-brand-200 dark:border-brand-800 hover:bg-brand-50 dark:hover:bg-brand-900/20 transition font-medium"
          >
            <PlayCircle className="w-4 h-4" /> {t('dashboard.replay_tutorial', 'Replay Tutorial')}
          </button>
        </div>
      </div>
    </div>
  );
};
