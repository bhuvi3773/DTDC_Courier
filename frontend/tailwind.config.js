/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        brand: {
          50: '#ecf9f4',
          100: '#d0efe4',
          200: '#a3dfca',
          400: '#35b48c',
          500: '#13936e',
          600: '#0d7a5f',
          700: '#0a5e49',
          900: '#063d30',
        },
        express: {
          50: '#fff1f2',
          100: '#ffe4e6',
          500: '#f43f5e',
          600: '#e11d48',
          700: '#be123c',
        },
      },
      boxShadow: {
        glass: '0 8px 32px rgba(15, 23, 42, 0.08)',
        card: '0 2px 12px rgba(15, 23, 42, 0.04)',
      },
    },
  },
  plugins: [],
};
