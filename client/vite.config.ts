import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@chatvault/shared': path.resolve(__dirname, '../shared/src') },
  },
  server: { port: 5173 },
});
