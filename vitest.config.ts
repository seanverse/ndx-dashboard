import { defineConfig } from 'vitest/config'

/**
 * 测试只覆盖 shared/ 下的纯计算与 server/ 的适配层，不需要 Vite 插件，
 * 因此单独建配置而不复用 vite.config.ts。
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Windows 下并行写 SSR 模块缓存会 EPERM（多进程同时 open 同一 hash 文件），串行规避
    fileParallelism: false,
    // 实连测试默认跳过，设 RUN_LIVE=1 才跑
    env: {},
  },
})
