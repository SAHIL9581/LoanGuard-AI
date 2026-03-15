import React from 'react';
import { motion } from 'framer-motion';
import {
  Check,
  Loader2,
  FileSearch,
  Calculator,
  ShieldCheck,
  Brain,
  Mail,
  BarChart2,
  Gauge,
  Zap,
} from 'lucide-react';

// ── Stage Definitions — 7 stages matching backend parallel pipeline ───────────
//
// Backend execution order:
//   Stage 1 — Parse & Extract (sequential)
//   Stage 2 — EMI Engine (sequential)
//   Stage 3+4 — RBI Violations + Behavioral Audit (parallel)
//   Stage 5 — Escalation Generation (sequential)
//   Stage 6+7 — Risk Score + Confidence (parallel)

interface StageDefinition {
  id: number;
  label: string;
  desc: string;
  icon: React.ElementType;
  parallelWith?: number;   // sibling stage id for parallel group
  parallelLabel?: string;  // label shown on connector between parallel pair
}

const STAGES: StageDefinition[] = [
  {
    id: 1,
    label: 'Extracting',
    desc: 'Parsing document structure & OCR',
    icon: FileSearch,
  },
  {
    id: 2,
    label: 'EMI Engine',
    desc: 'Deterministic EMI recalculation',
    icon: Calculator,
  },
  {
    id: 3,
    label: 'RBI Violations',
    desc: 'Regulatory compliance check',
    icon: ShieldCheck,
    parallelWith: 4,
    parallelLabel: 'parallel',
  },
  {
    id: 4,
    label: 'Behavioral Audit',
    desc: 'Threat & consent clause analysis',
    icon: Brain,
  },
  {
    id: 5,
    label: 'Escalations',
    desc: 'Generating 5-level letters',
    icon: Mail,
  },
  {
    id: 6,
    label: 'Risk Score',
    desc: 'Computing weighted risk score',
    icon: BarChart2,
    parallelWith: 7,
    parallelLabel: 'parallel',
  },
  {
    id: 7,
    label: 'Confidence',
    desc: 'Document completeness & confidence',
    icon: Gauge,
  },
];

// ── Stage state helper ────────────────────────────────────────────────────────

type StageState = 'done' | 'active' | 'pending';

function getStageState(stageId: number, currentStage: number): StageState {
  if (stageId < currentStage) return 'done';
  if (stageId === currentStage) return 'active';
  // Parallel pair: if partner is active, this one is also active
  return 'pending';
}

// For parallel stages (3+4, 6+7) — both light up when either is active
function getParallelState(
  stage: StageDefinition,
  currentStage: number
): StageState {
  const directState = getStageState(stage.id, currentStage);
  if (directState !== 'pending') return directState;
  if (
    stage.parallelWith !== undefined &&
    getStageState(stage.parallelWith, currentStage) === 'active'
  ) {
    return 'active';
  }
  return 'pending';
}

// ── Style maps ────────────────────────────────────────────────────────────────

function circleClasses(state: StageState): string {
  switch (state) {
    case 'done':
      return 'bg-green-500 border-green-500';
    case 'active':
      return 'bg-brand-600 border-brand-600 ring-4 ring-brand-200 dark:ring-brand-900/50';
    case 'pending':
      return 'bg-gray-100 dark:bg-gray-700 border-gray-200 dark:border-gray-600';
  }
}

function labelClasses(state: StageState): string {
  switch (state) {
    case 'done': return 'text-green-500';
    case 'active': return 'text-brand-600 dark:text-brand-400';
    case 'pending': return 'text-gray-400 dark:text-gray-500';
  }
}

function connectorClasses(state: StageState): string {
  switch (state) {
    case 'done': return 'bg-green-400';
    default: return 'bg-gray-200 dark:bg-gray-600';
  }
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  currentStage: number;
  isVisible: boolean;
  totalStages?: number;   // NEW: passed from LoanGuard
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface StageNodeProps {
  stage: StageDefinition;
  state: StageState;
  compact?: boolean;
}

const StageNode: React.FC<StageNodeProps> = ({ stage, state, compact = false }) => {
  const Icon = stage.icon;
  const size = compact ? 'w-9 h-9' : 'w-10 h-10';
  const iconSize = compact ? 'w-4 h-4' : 'w-5 h-5';

  return (
    <div className={`flex flex-col items-center gap-1.5 ${compact ? '' : 'flex-1'}`}>
      <motion.div
        animate={state === 'active' ? { scale: [1, 1.1, 1] } : { scale: 1 }}
        transition={{ repeat: state === 'active' ? Infinity : 0, duration: 1.4 }}
        className={`${size} rounded-full flex items-center justify-center border-2 transition-all duration-500 ${circleClasses(state)}`}
      >
        {state === 'done' ? (
          <Check className={`${iconSize} text-white`} />
        ) : state === 'active' ? (
          <Loader2 className={`${iconSize} text-white animate-spin`} />
        ) : (
          <Icon className={`${iconSize} text-gray-400`} />
        )}
      </motion.div>

      <div className="text-center max-w-[72px]">
        <p className={`text-xs font-semibold leading-tight ${labelClasses(state)}`}>
          {stage.label}
        </p>
        {state === 'active' && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 leading-tight"
          >
            {stage.desc}
          </motion.p>
        )}
      </div>
    </div>
  );
};

// ── Parallel pair block ───────────────────────────────────────────────────────

interface ParallelPairProps {
  stageA: StageDefinition;
  stageB: StageDefinition;
  stateA: StageState;
  stateB: StageState;
  label: string;
}

const ParallelPair: React.FC<ParallelPairProps> = ({
  stageA,
  stageB,
  stateA,
  stateB,
  label,
}) => {
  const pairActive = stateA === 'active' || stateB === 'active';
  const pairDone = stateA === 'done' && stateB === 'done';

  return (
    <div className="flex-1 flex flex-col items-center gap-1">
      {/* Parallel badge */}
      <span
        className={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border transition-all ${pairActive
            ? 'bg-brand-50 dark:bg-brand-900/30 border-brand-300 dark:border-brand-700 text-brand-500'
            : pairDone
              ? 'bg-green-50 dark:bg-green-900/20 border-green-300 dark:border-green-700 text-green-500'
              : 'bg-gray-100 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600 text-gray-400'
          }`}
      >
        <Zap className="inline w-2.5 h-2.5 mr-0.5 -mt-0.5" />
        {label}
      </span>

      {/* Two nodes side by side */}
      <div className="flex items-start gap-3">
        <StageNode stage={stageA} state={stateA} compact />
        <div className="flex flex-col items-center justify-center h-10 mt-0">
          <div
            className={`w-4 h-0.5 transition-all duration-700 ${pairDone ? 'bg-green-400' : pairActive ? 'bg-brand-400' : 'bg-gray-200 dark:bg-gray-600'
              }`}
          />
        </div>
        <StageNode stage={stageB} state={stateB} compact />
      </div>
    </div>
  );
};

// ── Main component ────────────────────────────────────────────────────────────

export const AnalysisStages: React.FC<Props> = ({
  currentStage,
  isVisible,
  totalStages = 7,
}) => {
  if (!isVisible) return null;

  // Progress percentage
  const progressPct = Math.min(
    Math.round(((currentStage - 1) / totalStages) * 100),
    100
  );

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      className="w-full max-w-3xl mx-auto mt-6"
    >
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-4 sm:p-6 shadow-lg">

        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Analysis Pipeline
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 dark:text-gray-500">
              Stage {Math.min(currentStage, totalStages)}/{totalStages}
            </span>
            <span
              className={`text-xs font-bold px-2 py-0.5 rounded-full ${progressPct === 100
                  ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                  : 'bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400'
                }`}
            >
              {progressPct}%
            </span>
          </div>
        </div>

        {/* NEW: Overall progress bar */}
        <div className="h-1 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden mb-5">
          <motion.div
            className="h-full bg-brand-500 rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${progressPct}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>

        {/* ── Mobile: Vertical Stepper ── */}
        <div className="md:hidden space-y-3">
          {STAGES.map((stage, index) => {
            const state = getParallelState(stage, currentStage);
            const isParallelSecond =
              stage.parallelWith !== undefined &&
              stage.parallelWith < stage.id;

            return (
              <div key={stage.id} className="relative flex items-start gap-3">
                {/* Parallel indicator */}
                {isParallelSecond && (
                  <div className="absolute left-[17px] -top-3">
                    <span className="text-[9px] font-bold text-brand-400 bg-brand-50 dark:bg-brand-900/30 px-1 rounded">
                      ⚡ parallel
                    </span>
                  </div>
                )}

                <motion.div
                  animate={state === 'active' ? { scale: [1, 1.08, 1] } : { scale: 1 }}
                  transition={{ repeat: state === 'active' ? Infinity : 0, duration: 1.4 }}
                  className={`w-9 h-9 rounded-full shrink-0 flex items-center justify-center border-2 transition-all duration-500 ${circleClasses(state)}`}
                >
                  {state === 'done' ? (
                    <Check className="w-4 h-4 text-white" />
                  ) : state === 'active' ? (
                    <Loader2 className="w-4 h-4 text-white animate-spin" />
                  ) : (
                    <stage.icon className="w-4 h-4 text-gray-400" />
                  )}
                </motion.div>

                <div className="min-w-0 pt-1.5">
                  <p className={`text-sm font-semibold ${labelClasses(state)}`}>
                    {stage.label}
                  </p>
                  {state === 'active' && (
                    <p className="text-xs text-gray-400 mt-0.5">{stage.desc}</p>
                  )}
                </div>

                {index < STAGES.length - 1 && (
                  <div
                    className={`absolute left-[17px] top-9 h-5 w-0.5 transition-all duration-700 ${state === 'done' ? 'bg-green-400' : 'bg-gray-200 dark:bg-gray-600'
                      }`}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* ── Desktop: Horizontal Pipeline with Parallel Groups ── */}
        <div className="hidden md:flex items-start gap-1">
          {/* Stage 1 */}
          <StageNode
            stage={STAGES[0]}
            state={getParallelState(STAGES[0], currentStage)}
          />

          {/* Connector 1→2 */}
          <div className={`flex-1 h-0.5 mt-5 transition-all duration-700 ${connectorClasses(getStageState(1, currentStage))}`} />

          {/* Stage 2 */}
          <StageNode
            stage={STAGES[1]}
            state={getParallelState(STAGES[1], currentStage)}
          />

          {/* Connector 2→parallel(3,4) */}
          <div className={`flex-1 h-0.5 mt-5 transition-all duration-700 ${connectorClasses(getStageState(2, currentStage))}`} />

          {/* Parallel Group: Stage 3 + 4 */}
          <ParallelPair
            stageA={STAGES[2]}
            stageB={STAGES[3]}
            stateA={getParallelState(STAGES[2], currentStage)}
            stateB={getParallelState(STAGES[3], currentStage)}
            label="parallel"
          />

          {/* Connector parallel(3,4)→5 */}
          <div className={`flex-1 h-0.5 mt-5 transition-all duration-700 ${connectorClasses(getStageState(4, currentStage))}`} />

          {/* Stage 5 */}
          <StageNode
            stage={STAGES[4]}
            state={getParallelState(STAGES[4], currentStage)}
          />

          {/* Connector 5→parallel(6,7) */}
          <div className={`flex-1 h-0.5 mt-5 transition-all duration-700 ${connectorClasses(getStageState(5, currentStage))}`} />

          {/* Parallel Group: Stage 6 + 7 */}
          <ParallelPair
            stageA={STAGES[5]}
            stageB={STAGES[6]}
            stateA={getParallelState(STAGES[5], currentStage)}
            stateB={getParallelState(STAGES[6], currentStage)}
            label="parallel"
          />
        </div>

        {/* Active stage description (desktop) */}
        <div className="hidden md:block mt-4 min-h-[20px]">
          {currentStage <= totalStages && STAGES[currentStage - 1] && (
            <motion.p
              key={currentStage}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-xs text-center text-gray-400 dark:text-gray-500"
            >
              {STAGES[currentStage - 1].desc}…
            </motion.p>
          )}
        </div>
      </div>
    </motion.div>
  );
};
