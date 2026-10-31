import type { TestContext } from 'node:test';

/** Prisma delegate 是动态 Proxy，不能用依赖属性描述符的 mock.method。 */
export function replaceMethod(t: TestContext, target: any, key: string, implementation: (...args: any[]) => any): void {
  const original = target[key];
  target[key] = implementation;
  t.after(() => { target[key] = original; });
}
