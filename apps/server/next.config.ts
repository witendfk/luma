import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // workspace 内的共享契约包按源码转译
  transpilePackages: ['@luma/shared'],
  // Prisma 引擎不参与打包
  serverExternalPackages: ['@prisma/client'],
};

export default nextConfig;
