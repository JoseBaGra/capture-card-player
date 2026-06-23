import { defineConfig } from 'vite';

export default {
  base: process.env.NODE_ENV === 'production' ? '/capture-card-player/' : '/',
};
