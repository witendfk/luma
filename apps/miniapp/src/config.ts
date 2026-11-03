/**
 * 服务端地址：开发联调用本地服务（pnpm dev:server，端口 4000）。
 * 交付前改为线上 HTTPS 域名，并在小程序后台配置 request/uploadFile/downloadFile 合法域名（设计文档 §5）。
 */
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? 'http://localhost:4000';
export const UI_MOCK = import.meta.env.DEV && import.meta.env.VITE_UI_MOCK === 'true';
