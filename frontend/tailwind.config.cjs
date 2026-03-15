/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['DM Sans', 'sans-serif'],
        serif: ['Comorant', 'serif'],
      },  
      colors: {
        brand: {
          50: '#f9fafb',
          100: '#f3f4f6',
          400: '#9ca3af',
          500: '#6b7280',
          600: '#4b5563',
          700: '#374151',
          900: '#111827',
        },
      },
    },
  },
  plugins: [],
}
