import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';

const root = path.resolve(__dirname, '../../../miniapp');
const miniappRequire = createRequire(path.join(root, 'package.json'));

/** 在没有 DOM 全局对象的逻辑层中执行实际小程序源码，网络与存储由测试提供。 */
export function miniappSandbox(overrides: Record<string, unknown> = {}, globals: Record<string, unknown> = {}) {
  const cache = new Map<string, any>();
  function load(name: string, parent = path.join(root, 'src/index.ts')): any {
    if (name in overrides) return overrides[name];
    if (!name.startsWith('.') && !name.startsWith('@/')) return miniappRequire(name);
    const filename = (name.startsWith('@/')
      ? path.join(root, 'src', name.slice(2))
      : path.resolve(path.dirname(parent), name)).replace(/(?:\.ts)?$/, '.ts');
    if (cache.has(filename)) return cache.get(filename);
    const exports = {};
    cache.set(filename, exports);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    vm.runInNewContext(code, {
      exports, require: (dep: string) => load(dep, filename), console,
      ArrayBuffer, Uint8Array, TextDecoder: undefined, TextEncoder: undefined,
      URLSearchParams: undefined, ...globals,
    }, { filename });
    return exports;
  }
  return { load, require: miniappRequire };
}

export function storageMock() {
  const values = new Map<string, unknown>();
  return {
    values,
    getStorageSync: (key: string) => values.get(key),
    setStorageSync: (key: string, value: unknown) => { values.set(key, value); },
    removeStorageSync: (key: string) => { values.delete(key); },
    getStorageInfoSync: () => ({ keys: [...values.keys()] }),
  };
}
