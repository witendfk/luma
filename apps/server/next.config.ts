import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // workspace 内的共享契约包按源码转译
  transpilePackages: ['@luma/shared'],
  // Prisma 引擎不参与打包
  serverExternalPackages: ['@prisma/client'],
  // Dynamic fs reads must remain available in production file-traced deployments.
  outputFileTracingIncludes: {
    '/*': ['./src/agent/prompts/**/*.md', './src/agent/skills/luma-tutor/SKILL.md'],
  },
};

export default nextConfig;
