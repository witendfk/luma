/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_DEV_LOGIN?: string;
}

/** 微信原生 API：仅 MP-WEIXIN 条件编译块内使用（@dcloudio/types 不含 wx，此处最小声明） */
declare const wx: {
  request(options: Record<string, unknown>): {
    onChunkReceived(cb: (res: { data: ArrayBuffer | string }) => void): void;
    abort(): void;
  };
};
