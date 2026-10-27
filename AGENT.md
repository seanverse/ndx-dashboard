# AGENT.md

NDX 情绪看板：八面板（行情 / 恐贪 / 波动率 / 估值 / 动量 / 宏观三因子 / 综合评分 / 操作建议）。React 19 + Vite + Tailwind v4 前端，Vercel Functions 后端，CF Worker 每 15 分钟当闹钟，数据落在 Vercel Blob。

## 权威文档

| 文档 | 管什么 |
| --- | --- |
| `../docs/PRD-001-NDX看板-需求与指标规范.html` | 业务口径：指标公式、分档阈值、验算。**业务结论以它为准** |
| `../docs/TECH-001-NDX看板-数据源与技术实现.md` | 数据源、解析陷阱、调度、额度、部署 |
| `README.md` | 本地运行、部署步骤、响应式断点、核对方式 |

改字段、改口径时同步 `shared/types.ts`、TECH-001 §6 与 PRD 对应章节。文档写的是决策理由，不是待办。

## 命令

```bash
npm install
npm run seed        # 灌真实数据到 .data/，需外网
npm run serve       # 本地全栈，默认 4173
npm run dev         # 纯前端，5173；需 API_PROXY 才有数据

npm run typecheck   # tsc strict + noUncheckedIndexedAccess
npm test            # vitest，串行（Windows 并行写 SSR 缓存会 EPERM）
npm run verify      # 逐项拉第二源核对数字，需先 seed
npm run audit -- <url> <width>   # CDP 量真实布局，不靠截图目测
```

实连测试默认跳过：`RUN_LIVE=1 npx vitest run tests/live-sources.test.ts`。

## 架构

```
CF Worker Cron */15  --POST /api/collect--> Vercel Function --┐
Vercel Cron 0 22 UTC --GET  /api/daily  --> Vercel Function --┴--> Vercel Blob
浏览器 --GET /api/dashboard--> 合并 latest.json + metrics.json，现算全部派生值
```

- `latest.json`：盘中截面原料（行情 / 恐贪 / 宏观现值）。常规时段每 15 分钟覆盖，其余 Globex 开市时段（盘前/盘后/深夜/假日）每小时一次，周末与每日 17:00–18:00 维护时段不写。
- `metrics.json`：日更产物（RSI / HV20 / VXN / PE / DXY 校验 / 宏观序列），每天覆盖。
- `data/daily/YYYY-MM-DD.json`：日快照，写一次不改，是唯一跨日历史。

分工不可挪：Worker 只有 10 ms CPU（解析日 K 必超），Vercel Function 有 300 s 但 Hobby Cron 每天只能 1 次。

## 目录职责

| 目录 | 运行位置 | 放什么 |
| --- | --- | --- |
| `api/` | **Vercel Functions**（Node 22，`vercel.json` 声明路由与每日 cron） | 4 个 HTTP 入口：`collect`（盘中采集）、`daily`（日更）、`dashboard`（前端数据）、`health`（自检） |
| `server/` | **Vercel Functions 内部**（由 `api/` import）；本地由 `scripts/` 以 tsx 复用 | `adapters/` 解析 Yahoo（盘中主源）、新浪、腾讯、CBOE、CNN、蛋卷、外汇各家格式；其余负责日更与盘中编排、美东日历、DXY 自算、日快照、Blob 读写 |
| `shared/` | **打进两侧**：浏览器 bundle + Vercel Function 都包含它 | `types.ts` 定义 API 字段结构，`compute/` 放阈值、RSI、统计、宏观压力、评分、建议。纯函数，不碰 IO |
| `worker/` | **Cloudflare Worker**（V8 isolate，cron `*/15`） | 定时器，每 15 分钟向 `/api/collect` 发一个 POST，仅此而已 |
| `src/` | **浏览器**（Vite 打包成静态文件进 `dist/`，由 Vercel 托管） | React 前端。`components/M1–M8` 是八个面板，`primitives.tsx` 是自绘 SVG，`api/client.ts` 管请求与轮询 |
| `scripts/` | **本地 Node**（tsx 直跑 / CDP） | `seed` 灌本地数据、`serve` 起本地全栈、`verify` 交叉核对数字、`audit` 量布局溢出 |
| `tests/` | **本地 Node**（vitest） | 指标黄金用例、日历、上游解析、存储配置、导入路径、实连测试 |
| `../docs/` | 不运行 | PRD-001 业务口径与指标规范，TECH-001 数据源、调度与部署 |

## 写码规则（按运行时）

- **`api/` + `server/`（Vercel Function，Node 22）**：可用 `node:` 模块（`fs`、`crypto` 已在用）；相对导入必须带 `.js`（见硬性规则 1）；每个文件默认导出 `handler`。
- **`worker/`（CF Worker）**：**没有 Node API**，只能用 Web API（`fetch` / `Response` / `AbortSignal` / `console`）；配置从 `env` 参数读（`[vars]` 写 `wrangler.toml`，密钥用 `wrangler secret put`）；CPU 上限 10 ms，所以只做转发，别加逻辑；类型引用 `@cloudflare/workers-types`。
- **`src/`（浏览器）**：只能用浏览器 API；import **不带** `.js`（Vite 负责解析打包）；需要计算时从 `shared/compute` 引纯函数。
- **`shared/`**：不许 `import node:*`、不许 `fetch` —— 它会进浏览器 bundle，混入服务端依赖即破坏构建。

## 部署

两条独立链路，部署方式不同：

| 侧 | 覆盖代码 | 怎么部署 |
| --- | --- | --- |
| Vercel | `api/` `server/` `shared/` `src/` | `git push` 即自动部署。`vercel.json` 声明构建命令（`npm run build`）、产物目录（`dist`）与每日 cron（`GET /api/daily`，22:00 UTC） |
| Cloudflare | `worker/` | **不随 git push**。手动：`cd worker && npx wrangler deploy`。`ORIGIN` 写在 `wrangler.toml`，`CRON_SECRET` 用 `npx wrangler secret put CRON_SECRET`（与 Vercel 同值） |

首次部署顺序不可反：建 Blob → 连接项目 + 手填 `BLOB_BASE_URL` 和 `CRON_SECRET` → deploy → 手动 curl `/api/daily` 与 `/api/collect` 灌首份数据。详细步骤与 Go/No-Go 检查见 README §5，出问题先 `GET /api/health`。

## 硬性规则

1. **`api/`、`server/`、`shared/` 的相对导入必须带 `.js`**，即使源文件是 `.ts`。线上按 ESM 加载，缺扩展名会在模块初始化阶段抛 `ERR_MODULE_NOT_FOUND`，四个端点同时 500，`tsc` 与 `vite build` 都抓不到。由 `tests/import-extensions.test.ts` 守。
2. **阈值只在 `shared/compute/bands.ts` 定义**（左闭右开 `[prev, max)`，最后一档 `Infinity`）。UI、评分、建议都从这里取，不要在组件里写魔法数。
3. **派生值只在 `/api/dashboard` 现算**。写入侧只存原料，避免两份分数打架。
4. **缺数返回 `null`，绝不返回 `0`**；HTTP 200 不等于数据有效，adapter 必须校验字段数与数值可比。
5. **采集失败不抛穿**：沿用上一版并标 `stale`，原因写进 `meta.warnings`。存储配置错误则显式 `invalid` 并拒绝读写——不能把配置问题藏成「还没数据」。
6. 前端轮询不得快于服务端缓存 TTL（现为 900 s vs `s-maxage=300`），否则请求穿透到 Function，Edge Requests 先于其他额度触顶。
7. 注释与文档用中文，解释「为什么」而不是复述代码；提交信息用 Conventional Commits。

## 测试对应关系

| 改动 | 该跑的 |
| --- | --- |
| 公式 / 分档 / 评分 / 建议 | `tests/prd-golden.test.ts` |
| 交易日历 / 时段 | `tests/calendar.test.ts` |
| 腾讯解析（两套格式） | `tests/tencent-parse.test.ts` |
| 日快照 / 数据新鲜度 | `tests/daily-snapshot.test.ts` |
| 存储与环境变量 | `tests/store-env.test.ts` |
| 导入路径 | `tests/import-extensions.test.ts` |
| 上游连通性 | `RUN_LIVE=1 ... live-sources.test.ts` |

## 部署要点

顺序不可反：**建 Blob → 填环境变量 → Deploy**。`BLOB_BASE_URL` 不会自动注入，必须手填。未设 `CRON_SECRET` 时触发端点一律 401。

出问题先看 `GET /api/health`：分步骤报告运行时、存储三态、Blob 变量实际命中名、基址探测状态码、两个对象可读性，不返回凭证值。`blob_probe` 的 404（基址对、还没灌数）与 400 / 403 / null（基址错 / 私有库 / 连不上）是排查分叉点。

## 已知口径偏差

D1–D10 见 README §8，均已在 UI 注明，不是 bug。不要「顺手修正」成与 PRD 冲突的行为。
