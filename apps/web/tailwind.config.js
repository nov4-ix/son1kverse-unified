/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    '../../packages/shared-ui/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        xentrix: {
          bg: '#E8EAED',
          panel: '#F5F6F8',
          ink: '#1A1D23',
          muted: '#6B7280',
          line: '#C5C9D1',
          accent: '#3A3F4B',
        },
        alvae: {
          bg: '#0A0B0E',
          panel: '#12151C',
          gold: '#D4A359',
          ember: '#F59E0B',
          terminal: '#10B981',
          ink: '#E7E5E4',
          muted: '#8A8478',
        },
      },
      fontFamily: {
        clinical: ['Segoe UI', 'Helvetica Neue', 'Arial', 'sans-serif'],
        terminal: ['IBM Plex Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      keyframes: {
        flicker: {
          '0%, 100%': { opacity: '1' },
          '18%': { opacity: '0.12' },
          '22%': { opacity: '1' },
          '48%': { opacity: '0.35' },
          '52%': { opacity: '1' },
          '78%': { opacity: '0.08' },
          '82%': { opacity: '1' },
        },
        pulsePixel: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.15' },
        },
      },
      animation: {
        flicker: 'flicker 1.2s steps(2, end)',
        'pulse-pixel': 'pulsePixel 1.8s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
