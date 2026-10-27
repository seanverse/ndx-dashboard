/**
 * 相对导入必须带 .js 扩展名。
 *
 * 背景：package.json 是 "type": "module"，api/ 下的函数由 @vercel/node 逐个部署，
 * 运行时走 Node 的 ESM 加载器。ESM 不像 CJS 那样自动补全扩展名，`from '../server/store'`
 * 在线上会抛 ERR_MODULE_NOT_FOUND —— 而且是在模块初始化阶段抛，handler 里的 try/catch
 * 拦不住，页面只会看到 500 FUNCTION_INVOCATION_FAILED。
 *
 * 这个错误 tsc 抓不到（moduleResolution: bundler 认为会有打包器兜底）、vite build 也抓不到
 * （只处理 src/，不看 api/ 和 server/），本地 tsx 更是照常运行。只有线上才炸，
 * 而且四个端点同时全炸。所以用测试锁住它。
 *
 * 源码里写 .js 指向 .ts 是 TypeScript 的既有约定（extension substitution），
 * tsc 与 Vite 都能正确解析，编译产物里就是真实存在的 .js 文件。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
/** 这三个目录都会进入服务端运行时；src/ 由 Vite 打包，不受此约束 */
const SERVER_DIRS = ['api', 'server', 'shared']

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return walk(full)
    return /\.tsx?$/.test(name) ? [full] : []
  })
}

/** 抓 `from './x'`、`export * from './x'`、`import('./x')` 三种写法 */
const RELATIVE_SPEC = /(?:from|import)\s*\(?\s*'(\.[^']*)'/g

describe('服务端模块的相对导入', () => {
  const files = SERVER_DIRS.flatMap((d) => walk(path.join(ROOT, d)))

  it('至少扫描到预期的文件数，避免规则空跑', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it('每条相对导入都带 .js（否则线上 ESM 加载器解析不到）', () => {
    const bad: string[] = []

    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      for (const match of src.matchAll(RELATIVE_SPEC)) {
        const spec = match[1]
        if (spec === undefined) continue
        if (/\.(js|mjs|cjs|json|css)$/.test(spec)) continue
        const line = src.slice(0, match.index).split('\n').length
        bad.push(`${path.relative(ROOT, file)}:${line}  →  ${spec}`)
      }
    }

    expect(bad, `以下相对导入缺少 .js 扩展名：\n${bad.join('\n')}`).toEqual([])
  })

  it('带 .js 的路径真实存在对应源码，防止补错名字', () => {
    const missing: string[] = []

    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      for (const match of src.matchAll(RELATIVE_SPEC)) {
        const spec = match[1]
        if (spec === undefined || !spec.endsWith('.js')) continue
        const abs = path.resolve(path.dirname(file), spec)
        const asTs = abs.replace(/\.js$/, '.ts')
        const asTsx = abs.replace(/\.js$/, '.tsx')
        if (!statSync(abs, { throwIfNoEntry: false }) && !statSync(asTs, { throwIfNoEntry: false }) && !statSync(asTsx, { throwIfNoEntry: false })) {
          missing.push(`${path.relative(ROOT, file)}  →  ${spec}`)
        }
      }
    }

    expect(missing, `以下导入指向不存在的文件：\n${missing.join('\n')}`).toEqual([])
  })
})
