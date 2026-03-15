import React, { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload,
  FileText,
  AlertCircle,
  Loader2,
  File,
  Home,
  Building2,
  CreditCard,
  X,
  CheckCircle,
  Car,
  GraduationCap,
} from 'lucide-react';

interface Props {
  onFileUpload: (file: File) => void;
  onTextSubmit: (text: string) => void;
  isLoading: boolean;
  uploadProgress?: number;   // NEW: from LoanGuard
}

const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const MIN_TEXT_LENGTH = 50;

const LOAN_TYPE_PILLS = [
  { icon: File, label: 'Personal Loan' },
  { icon: Home, label: 'Home Loan' },
  { icon: Building2, label: 'NBFC Agreement' },
  { icon: CreditCard, label: 'Credit Card' },
  { icon: Car, label: 'Auto Loan' },
  { icon: GraduationCap, label: 'Education Loan' },
];

export const UploadSection: React.FC<Props> = ({
  onFileUpload,
  onTextSubmit,
  isLoading,
  uploadProgress = 0,
}) => {
  const [mode, setMode] = useState<'pdf' | 'text'>('pdf');
  const [rawText, setRawText] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [rejectionError, setRejectionError] = useState<string | null>(null);

  // ── Dropzone ──────────────────────────────────────────────────────────────

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      setRejectionError(null);
      if (acceptedFiles.length > 0 && !isLoading) {
        const file = acceptedFiles[0];
        setSelectedFile(file);
        onFileUpload(file);
      }
    },
    [onFileUpload, isLoading]
  );

  const onDropRejected = useCallback(
    (fileRejections: import('react-dropzone').FileRejection[]) => {
      const first = fileRejections[0];
      if (!first) return;
      const code = first.errors[0]?.code;
      if (code === 'file-too-large') {
        setRejectionError(
          `File is too large. Maximum size is ${MAX_FILE_SIZE_MB}MB.`
        );
      } else if (code === 'file-invalid-type') {
        setRejectionError('Only PDF files are supported.');
      } else {
        setRejectionError(first.errors[0]?.message ?? 'File rejected.');
      }
    },
    []
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    onDropRejected,
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 1,
    maxSize: MAX_FILE_SIZE_BYTES,
    disabled: isLoading,
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  const handleModeSwitch = (m: 'pdf' | 'text') => {
    setMode(m);
    setRejectionError(null);
    // FIX: clear selected file when switching modes
    if (m === 'pdf') setRawText('');
    if (m === 'text') setSelectedFile(null);
  };

  const handleTextSubmit = () => {
    if (rawText.trim().length >= MIN_TEXT_LENGTH && !isLoading) {
      onTextSubmit(rawText);
    }
  };

  const handleClearText = () => {
    setRawText('');
  };

  const textLength = rawText.length;
  const textTooShort = textLength > 0 && textLength < MIN_TEXT_LENGTH;
  const textReady = textLength >= MIN_TEXT_LENGTH;

  // Upload progress display
  const showProgress = isLoading && uploadProgress > 0 && uploadProgress < 100;
  const uploadComplete = isLoading && uploadProgress === 100;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="w-full max-w-3xl mx-auto">

      {/* Mode Toggle */}
      <div className="flex bg-gray-100 dark:bg-gray-800 rounded-xl p-1 mb-6">
        {(['pdf', 'text'] as const).map((m) => (
          <button
            key={m}
            onClick={() => handleModeSwitch(m)}
            disabled={isLoading}
            className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-semibold transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${mode === m
              ? 'bg-white dark:bg-gray-700 text-brand-600 dark:text-brand-400 shadow-sm'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
          >
            {m === 'pdf' ? (
              <>
                <File className="w-4 h-4" />
                Upload PDF
              </>
            ) : (
              <>
                <FileText className="w-4 h-4" />
                Paste Text
              </>
            )}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">

        {/* ── PDF Mode ───────────────────────────────────────────────────── */}
        {mode === 'pdf' && (
          <motion.div
            key="pdf"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            {/* Dropzone */}
            <div
              {...getRootProps()}
              className={`relative border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all duration-300 ${isDragActive
                ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20 scale-[1.02]'
                : 'border-gray-300 dark:border-gray-600 hover:border-brand-400 dark:hover:border-brand-500 bg-white dark:bg-gray-800/50'
                } ${isLoading ? 'opacity-60 cursor-not-allowed pointer-events-none' : ''}`}
            >
              <input {...getInputProps()} />

              <motion.div
                animate={{ scale: isDragActive ? 1.08 : 1 }}
                transition={{ type: 'spring', stiffness: 300 }}
                className="flex flex-col items-center gap-4"
              >
                {/* Icon area */}
                {isLoading ? (
                  <div className="w-16 h-16 rounded-full bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center">
                    <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
                  </div>
                ) : (
                  <div className="w-16 h-16 rounded-full bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center">
                    <Upload className="w-8 h-8 text-brand-600 dark:text-brand-400" />
                  </div>
                )}

                {/* Title */}
                <div>
                  <p className="text-lg font-semibold text-gray-800 dark:text-gray-100">
                    {isLoading && uploadComplete
                      ? 'Processing document…'
                      : isLoading
                        ? 'Uploading…'
                        : isDragActive
                          ? 'Drop your PDF here'
                          : 'Drop your loan agreement PDF'}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    {isLoading
                      ? selectedFile?.name ?? 'Analyzing…'
                      : `or click to browse · PDF only · Max ${MAX_FILE_SIZE_MB}MB`}
                  </p>
                </div>

                {/* NEW: Upload progress bar */}
                {isLoading && (
                  <div className="w-full max-w-xs">
                    <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-brand-500 rounded-full"
                        initial={{ width: 0 }}
                        animate={{
                          width: uploadComplete
                            ? '100%'
                            : showProgress
                              ? `${uploadProgress}%`
                              : '60%', // indeterminate pulse if no progress event
                        }}
                        transition={{ duration: 0.4 }}
                      />
                    </div>
                    <p className="text-xs text-center text-gray-400 mt-1">
                      {uploadComplete
                        ? 'Running AI analysis…'
                        : showProgress
                          ? `Uploading ${uploadProgress}%`
                          : 'Analyzing document…'}
                    </p>
                  </div>
                )}

                {/* Loan type pills */}
                {!isLoading && (
                  <div className="flex gap-2 mt-1 flex-wrap justify-center">
                    {LOAN_TYPE_PILLS.map(({ icon: IconComponent, label }) => (
                      <span
                        key={label}
                        className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-3 py-1 rounded-full flex items-center gap-1.5"
                      >
                        <IconComponent className="w-3 h-3" />
                        {label}
                      </span>
                    ))}
                  </div>
                )}
              </motion.div>
            </div>

            {/* FIX: Rejection error banner */}
            <AnimatePresence>
              {rejectionError && (
                <motion.div
                  initial={{ opacity: 0, height: 0, marginTop: 0 }}
                  animate={{ opacity: 1, height: 'auto', marginTop: 12 }}
                  exit={{ opacity: 0, height: 0, marginTop: 0 }}
                  className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl"
                >
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                  <p className="text-xs text-red-600 dark:text-red-400 flex-1">
                    {rejectionError}
                  </p>
                  <button
                    onClick={() => setRejectionError(null)}
                    className="text-red-400 hover:text-red-600 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Selected file info (pre-upload) */}
            <AnimatePresence>
              {selectedFile && !isLoading && !rejectionError && (
                <motion.div
                  initial={{ opacity: 0, height: 0, marginTop: 0 }}
                  animate={{ opacity: 1, height: 'auto', marginTop: 12 }}
                  exit={{ opacity: 0, height: 0, marginTop: 0 }}
                  className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl"
                >
                  <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                  <p className="text-xs text-green-700 dark:text-green-400 flex-1 truncate">
                    {selectedFile.name}{' '}
                    <span className="text-green-500">
                      ({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)
                    </span>
                  </p>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedFile(null);
                      setRejectionError(null);
                    }}
                    className="text-green-400 hover:text-green-600 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}

        {/* ── Text Mode ──────────────────────────────────────────────────── */}
        {mode === 'text' && (
          <motion.div
            key="text"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="space-y-3"
          >
            {/* Textarea */}
            <div className="relative">
              <textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder="Paste your loan agreement text here… (minimum 50 characters)&#10;&#10;Tip: Copy the full agreement including all clauses, charges, and interest terms for the most accurate analysis."
                className={`w-full h-52 p-4 rounded-xl border text-sm resize-none transition-all focus:outline-none focus:ring-2 ${textTooShort
                  ? 'border-red-300 dark:border-red-700 focus:ring-red-400 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200'
                  : textReady
                    ? 'border-green-300 dark:border-green-700 focus:ring-green-400 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200'
                    : 'border-gray-200 dark:border-gray-600 focus:ring-brand-500 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200'
                  } disabled:opacity-60 disabled:cursor-not-allowed`}
                disabled={isLoading}
              />
              {/* FIX: clear button inside textarea */}
              {rawText.length > 0 && !isLoading && (
                <button
                  onClick={handleClearText}
                  className="absolute top-3 right-3 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
                  title="Clear text"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Footer row */}
            <div className="flex items-center justify-between gap-4">
              {/* Character count + validation */}
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs ${textTooShort
                    ? 'text-red-400'
                    : textReady
                      ? 'text-green-500'
                      : 'text-gray-400'
                    }`}
                >
                  {textLength.toLocaleString()} characters
                </span>
                {textTooShort && (
                  <span className="text-xs text-red-400 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    Need {MIN_TEXT_LENGTH - textLength} more
                  </span>
                )}
                {textReady && (
                  <span className="text-xs text-green-500 flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" />
                    Ready to analyze
                  </span>
                )}
              </div>

              {/* Submit button */}
              <button
                onClick={handleTextSubmit}
                disabled={!textReady || isLoading}
                className="px-6 py-2.5 bg-brand-600 hover:bg-brand-700 active:scale-95 disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold transition-all duration-200 flex items-center gap-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Analyzing…
                  </>
                ) : (
                  <>
                    <FileText className="w-4 h-4" />
                    Analyze Text
                  </>
                )}
              </button>
            </div>

            {/* Tip banner */}
            {!isLoading && textLength === 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl"
              >
                <p className="text-xs text-blue-600 dark:text-blue-400">
                  <span className="font-semibold">Tip:</span> For best results, paste the
                  complete agreement text including all interest rate clauses, fee schedules,
                  penal charge terms, and foreclosure conditions. Truncated text reduces
                  detection accuracy.
                </p>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
