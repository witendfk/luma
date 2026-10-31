import { defineConfig } from 'vite';
import uni from '@dcloudio/vite-plugin-uni';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [uni()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // workspace 共享契约包按源码引入（GitHub 模板不可用，手写等价工程）
      '@luma/shared': fileURLToPath(new URL('../../packages/shared/src', import.meta.url)),
    },
  },
});
