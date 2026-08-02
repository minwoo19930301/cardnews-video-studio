import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: '.',
  publicDir: 'public',
  server: {
    port: 5179,
    open: false,
  },
  build: {
    outDir: 'dist-admin',
  },
});
