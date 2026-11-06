/**
 * 服务端地址：开发联调用本地服务（pnpm dev:server，端口 4000）。
 * 交付前改为线上 HTTPS 域名，并在小程序后台配置 request/uploadFile/downloadFile 合法域名（设计文档 §5）。
 */
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? 'http://localhost:4000';
// 交互验收已结束。保留类型兼容标记，应用运行时永久使用正式服务；
// 自动化测试通过独立沙箱注入替身，环境变量不能再开启示例工作区。
export const UI_MOCK: boolean = false;
