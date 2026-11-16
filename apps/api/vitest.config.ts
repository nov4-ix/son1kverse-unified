import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
  resolve: {
    // Los imports del código y de los tests usan extensión `.js` sobre fuentes
    // `.ts` (estándar ESM/TS). Vite necesita que se le indique.
    extensionAlias: {
      '.js': ['.ts', '.js'],
    },
  },
})
