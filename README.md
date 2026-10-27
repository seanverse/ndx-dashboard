# NDX Dashboard

NASDAQ-100 市场情绪监测看板。八面板：行情 / 恐贪 / 波动率 / 估值 / 动量 / 宏观三因子 / 综合评分 / 操作建议。PC 与 H5 自适应，无第三方图表库。

业务与指标口径：`../docs/PRD-001-NDX看板-需求与指标规范.html`
数据源与部署选型：`../docs/TECH-001-NDX看板-数据源与技术实现.md`

## 1. 架构

```
CF Worker Cron (*/15 * * * *)  --POST /api/collect-->  Vercel Function ─┐
  只当闹钟，不抓数据                                   抓快照+恐贪+算分    │
                                                                        ├─> Vercel Blob
Vercel Cron (0 22 * * *)      --GET  /api/daily----->  Vercel Function ─┘   latest.json
  每天 1 次（Hobby 上限）                              日K+RSI/HV/PE/VXN       metrics.json
                                                                              │
浏览器  --GET /api/dashboard-->  合并两个 Blob，s-maxage=300 ──────────────────┘
```

分工原因：CF Worker 有 1 分钟粒度 Cron 但每次仅 10 ms CPU（`JSON.parse` 180 KB 日K 必超），Vercel Function 有 300 s 且 IO 等待不计 CPU，但 Hobby Cron 每天只能 1 次。两者各取其长，GitHub Actions 不参与链路。

## 2. 本地跑起来

```bash
npm install

# 1) 灌一次真实数据（连外网，约 2–3 s），写到 .data/
npm run seed

# 2) 起本地全栈：静态站 + /api/dashboard（读 .data/），默认 4173
npm run serve
# 打开 http://localhost:4173
```

纯前端调样式用 `npm run dev`（Vite 5173，需 `API_PROXY=https://<你的域名>` 才有数据）。
没有 Blob token 时存储自动落 `.data/`，不需要额外配置。

## 3. 目录

```
shared/          前端与后端共用的纯计算，无 IO
  compute/       分档阈值 bands.ts、RSI、统计、评分、建议、面板装配
  types.ts       API 契约（唯一真源）
server/          仅服务端
  adapters/      新浪 / 腾讯 / CBOE / CNN / 蛋卷 / 外汇，各源字段序差异在此消化
  calendar.ts    美东时间、假日、交易日与时段判定
  dxy.ts         DXY 自算（六货币对 + 官方常量 50.14348112）与偏差校验
  series.ts      日更：7 源并发 → DailyMetrics
  sources.ts     盘中：快照 + 恐贪，主源失败切腾讯并做 0.3% 偏差校验
  assemble.ts    合并 latest + metrics → DashboardResponse
  snapshot.ts    日快照：剥离上游长序列 + 记录当日结论
  store.ts       Vercel Blob / 本地 .data 双模式
api/             Vercel Functions：collect.ts / daily.ts / dashboard.ts / health.ts
worker/          CF Worker：只有 scheduled() 发一次 POST
src/             React 19 + Tailwind v4，8 个面板组件 + 自绘 SVG 原子
tests/           prd-golden（指标黄金用例）/ calendar / tencent-parse / daily-snapshot / import-extensions / live-sources（实连）
scripts/         seed / serve / audit-overflow（CDP 量真实布局）
```

> **写 import 时注意**：`api/`、`server/`、`shared/` 里的相对导入必须带 `.js`，即使源文件是 `.ts`。
> `package.json` 是 `"type": "module"`，这些文件在 Vercel 上按 ESM 加载，缺扩展名会在模块初始化阶段抛
> `ERR_MODULE_NOT_FOUND`，表现是整站 500 `FUNCTION_INVOCATION_FAILED` 且四个端点同时失效。
> `tsc` 和 `vite build` 都不报这个错，靠 `tests/import-extensions.test.ts` 拦。

## 4. 环境变量

| 变量 | 用途 | 写在哪 |
| --- | --- | --- |
| `CRON_SECRET` | 两个触发端点共用的 Bearer，`openssl rand -hex 32` | Vercel 环境变量 + `wrangler secret put` |
| `BLOB_READ_WRITE_TOKEN` | Blob 读写，建 Store 后自动注入 | Vercel 环境变量 |
| `BLOB_STORE_ID` | 与 OIDC 配对定位 store，连接项目后自动注入 | Vercel 环境变量 |
| `BLOB_BASE_URL` | 读 Blob 的公网基址，**不会自动注入，必须手填** | Vercel 环境变量 |
| `ORIGIN` | Worker 要打的 Vercel 域名 | `worker/wrangler.toml` |

两个 Blob 变量允许带前缀：建库时勾了 Advanced Options 里的 prefix（例如得到 `NDX_BLOB_READ_WRITE_TOKEN`），代码会按唯一后缀匹配取到；同时存在多个前缀版本则报错。`BLOB_BASE_URL` 不受前缀影响，仍然是固定的名字。

未设置 `CRON_SECRET` 时两个触发端点一律返回 401（宁可拒，不可裸奔）。

## 5. 部署

### 5.0 代码进仓库

```bash
git init -b main
git add .
git commit -m "feat: NDX 情绪看板"
git remote add origin git@github.com:<owner>/ndx-dashboard.git
git push -u origin main
```

`.gitignore` 已排除 `node_modules/`、`dist/`、`.data/`、`.env*`、`.vercel/`、`worker/.wrangler/`。推送走 SSH，HTTPS 在本机会间歇性 502。

### 5.1 Vercel

**顺序不能反：先建 Blob → 再填变量 → 最后 Deploy。** 反过来 `BLOB_BASE_URL` 为空，`/api/dashboard` 会一直返回 NotReady。

1. **Storage → Blob → Create**，记下公网基址 `https://<store-id>.public.blob.vercel-storage.com`
2. **Add New → Project** 导入仓库。零配置能识别 Vite：`npm run build` → `dist`，`api/*.ts` 自动成为 Functions，`vercel.json` 的 `0 22 * * *` 声明 `/api/daily`
3. **Environment Variables**（Production + Preview 都勾）：

   | 变量 | 值 |
   | --- | --- |
   | `CRON_SECRET` | `openssl rand -hex 32` 生成，Worker 侧必须用同一个值 |
   | `BLOB_READ_WRITE_TOKEN` | 建 Blob 并 connect 到项目后自动注入，不用手填 |
   | `BLOB_BASE_URL` | 第 1 步记下的基址，末尾不要带 `/` |

   把 Blob 连接到项目时如果填了前缀（Advanced Options），变量会变成 `NDX_BLOB_READ_WRITE_TOKEN` 这类带前缀的名字，代码能认；但 `BLOB_BASE_URL` 不在自动注入之列，无论有没有前缀都要手动加。

   配错时的表现：`/api/dashboard` 返回 503 且 `hint` 里直接写明缺哪一项，`storage` 字段为 `invalid`。正常「还没灌数据」的情况 `storage` 为 `blob`，两者的区分就在这里。

4. **Deploy**

### 5.2 灌首次数据

Cron 还没到点，必须先手动跑，否则首页是 NotReady。

```bash
S=https://<域名>
K=<CRON_SECRET>

# ① 日更：NDX 日 K → RSI / HV20 / PE 分位 / VXN / DXY 校验 → metrics.json
curl -X GET "$S/api/daily" -H "Authorization: Bearer $K"

# ② 盘中截面：行情 + 恐贪 + 宏观现值 → latest.json
curl -X POST "$S/api/collect" -H "Authorization: Bearer $K"
```

① 返回 `ok:true` 且 `tradeDate` 为最近交易日即就绪；当天已跑过则返回 `skipped:'already-done'`，同样算就绪。

② **采集分两档**（防止空数据覆盖好缓存，也控制 Blob 写额度）：
- 股市常规时段（美东 09:30–16:20，半日市到 13:20）：每 15 分钟写一次
- 其余 Globex 开市时段（盘前 / 盘后 / 深夜 / 假日——油、金、DXY 近 23 小时都在交易）：每小时一次
- 周五 17:00–周日 18:00 与每日 17:00–18:00 维护时段：返回 `skipped:'off-hours'` 且不写数据

在周末首次部署时，行情面板要等到周日 18:00 ET 之后才有数据。

### 5.3 CF Worker

**前置条件**：`GET /api/health` 的 `store_status.mode` 已经是 `blob`，且手动 `POST /api/collect` 能返回 200。Worker 只负责定时发这一个请求，接口没通之前部署它只会得到每 15 分钟一条失败日志。

```bash
npx wrangler login                                 # 浏览器授权一次，凭证存本机
npm run worker:deploy                              # 先建出 Worker
npm run worker:secret                              # 再写 CRON_SECRET（与 Vercel 同值）
npm run worker:tail                                # 等一个 15 分钟周期看日志
```

**部署必须排在写 secret 之前**：`wrangler secret put` 作用在已存在的 Worker 上，脚本还不存在时会报 `script not found`。两条命令之间若有 cron 恰好触发，Worker 会打印 `ORIGIN 或 CRON_SECRET 未配置` 后直接返回，不写任何数据，下一个 15 分钟周期自然恢复。

三个脚本都带 `--config worker/wrangler.toml`，所以在仓库根目录执行即可，不用 `cd worker`。

`ORIGIN` 写在 `worker/wrangler.toml` 的 `[vars]` 里，必须与 Vercel 生产域名完全一致（含 `https://`，不带尾斜杠）。写错时 Worker 收到 404/530 且 Cloudflare 的 cron 没有重试机制，只能靠 `tail` 的日志发现。

`wrangler login` 打不开浏览器时，改用 API Token：Cloudflare 控制台 → My Profile → API Tokens → 用 `Edit Cloudflare Workers` 模板建一个，然后

```bash
export CLOUDFLARE_API_TOKEN=xxx    # PowerShell: $env:CLOUDFLARE_API_TOKEN="xxx"
npm run worker:deploy
```

### 5.4 全链路通

打开站点，顶部评分条出现健康分即通。

出问题时先看 `GET /api/health`：它把运行时、存储状态、Blob 相关环境变量的实际名字、基址可达性、两个对象的读取结果分步跑一遍，返回哪一步失败、缺什么。不返回任何凭证值。

`blob_probe` 这一步专门用来区分「基址写错」和「还没灌数」——空库时两者在页面上完全一样：

| `status` | 含义 |
|---|---|
| `404` | 基址正确，对象还没写入（正常） |
| `400` | 该域名下没有这个库，`BLOB_BASE_URL` 填错了 |
| `403` | 库存在但不可公开读，建库时选了 Private |
| `null` | 连不上，域名拼错或库已删除 |

### Go/No-Go 检查（部署后逐条打勾）

- [ ] `GET /api/health` 的 `ok` 为 `true`，且 `store_status.mode` 为 `blob`
- [ ] `GET /api/dashboard` 返回 200，`meta.sources` 里 ndx/oil/gold/dxy/fearGreed 均非 `missing`
- [ ] `meta.warnings` 出现「恐贪底层为 S&P 500」提示（口径已知偏差，不是故障）
- [ ] 日更后 `dxyCheck.ok === true`，且 `dxyCheck.sameSession === true`（收盘后 3 小时内跑，容差 0.05%；跨时点手动触发时容差放宽到 0.5%，只做量级校验）
- [ ] 等一个 15 分钟周期，`latest.json` 的 `generatedAt` 推进
- [ ] `npm run worker:tail` 里出现 `{"ok":true,"status":200,...}`（`status:401` 是两侧 `CRON_SECRET` 不一致）
- [ ] 周末或每日维护时段（17:00–18:00 ET）触发 `/api/collect` 返回 `skipped:'off-hours'`，不写 Blob
- [ ] 常规时段 8 分钟内重复触发返回 `skipped:'too-soon'`；深夜（extended）触发正常写入，且 50 分钟内重复触发被挡
- [ ] Vercel Blob 用量页：Advanced Ops 增速 ≈ 每天 32 次（常规 27 + extended 摊平）

## 6. 验证

```bash
npm run typecheck        # strict + noUncheckedIndexedAccess
npm test                 # 98 项：黄金用例 + 日历（含 Globex 分档）+ 腾讯双格式 + 日快照
npm run verify           # 取数核对：把页面每个数字和第二源对一遍（需先 npm run seed）
```

实连测试（会打外网，也是出口 IP 的探针）：

```bash
# bash
RUN_LIVE=1 npx vitest run tests/live-sources.test.ts
# PowerShell
$env:RUN_LIVE='1'; npx vitest run tests/live-sources.test.ts
```

布局回归（用 CDP 量真实 `clientWidth` / `scrollWidth`，不靠截图目测；`--window-size` 在 Windows 下有最小窗口宽度，截图宽度不等于渲染宽度）：

```bash
npm run audit -- http://localhost:4173/ 390          # 只体检
npm run audit -- http://localhost:4173/ 390 out.png  # 顺带出图
PANELS=1 npm run audit -- http://localhost:4173/ 1440  # 额外打印各面板 top/bottom/高度
RECTS='[data-advice-card]' npm run audit -- http://localhost:4173/ 1440  # 打印指定元素矩形
CLICK=1 npm run audit -- http://localhost:4173/ 1440   # 点开所有折叠块，验证展开后不溢出
```

### 响应式断点

| 视口 | 栅格 | 综合判断 / 操作建议 |
| --- | --- | --- |
| < 768 | 单栏 | 各自整行（等宽） |
| 768 – 1023 | 两栏 | 各占 2 栏 = 整行 |
| 1024 – 1199 | 三栏 | 各占 3 栏 = 整行 |
| ≥ 1200 | 三栏 | **并排两列，各 572px** |

并排门槛用 `min-[1200px]` 而不是 Tailwind 的 `xl`(1280)：页面 `max-w` 是 1200，1280 之后内容宽不再变化，用 1280 会让 1200–1279 这段本可容纳两列却白白堆叠。

面板**内部**的列数一律用容器查询（`@container` + `@min-[...]`），因为同一个面板在 768–1023 是两栏宽、≥1024 是整行宽，视口断点和它实际可用宽度并不同步：

- 维度卡：容器 ≥500px 走四列，否则 2×2
- 综合判断结论区 ↔ 维度卡：容器 ≥900px 才横向并排
- 操作建议两张卡：容器 ≥560px 才并排（低于此值内宽不足 240px，最长一条建议会折行并留孤字）

并排时**两格等高拉伸**（grid 默认 stretch，不设 `items-start`），底边严格齐平。多出来的高度不放在面板底部，而是由各自内部吸收：

- 操作建议：卡片区 `flex-1`，两张建议卡撑满剩余高度、内容垂直居中，脚注被推到面板底部
- 综合判断：结论区与明细表之间插一个 `flex-1` 空白层，明细表仍贴底

早期版本用 `.panel--auto`（`height:auto`）让两块各取内容高度，结果并排时右块比左块矮 78px，底边错位。反向做法（只加 `height:100%` 而不处理内部）会把 78px 全堆在面板底部成为空白带——两者都不可取，现在是把余量分配给内容。

注：`.panel--auto` 仍保留在 `styles.css` 里，但「综合判断 / 操作建议」不再使用。

### 取数核对（`npm run verify`）

实连测试只能证明「没抛异常」，证明不了「数字对」。这个脚本逐项拉第二源比对，默认 20 项：

| 指标 | 页面源 | 对照源 |
| --- | --- | --- |
| NDX 收/开/高/低/昨收/量 | 新浪 `gb_ndx` | 腾讯 `usNDX` |
| NDX 收盘 | 快照 | 新浪日 K 末根（校验解析层） |
| WTI / 黄金 | 新浪 `hf_CL` `hf_GC` | 腾讯 `hf_CL` `hf_GC` |
| 美元指数 | 新浪 `DINIW` | 六货币对自算 |
| VXN | CBOE CSV 日更 | CBOE CSV 最新行 |
| 恐贪 | 快照 | CNN 官方 JSON |
| PE / 百分位 | 日更 | 蛋卷 `detail` 接口 |
| RSI6/12/24 | 日更 | 第二套实现重算（不同种子口径） |

期货在盘中会跳动，页面值是快照时点，因此按 1% 容差判；收盘类指标按 0.01%。

## 7. 额度（Vercel Hobby，2026-09 口径）

| 项 | 免费额度 | 本项目月耗 | 占比 |
| --- | --- | --- | --- |
| Blob Advanced Ops | 2,000 | ≈ 970 | **48%（唯一吃紧项）** |
| Function 调用 | 100 万 | ≈ 2,910 | 0.3% |
| Active CPU | 4 CPU-hr | ≈ 339 s | 2.4% |
| CF Worker CPU | 10 ms/次 | < 3 ms/次 | 30% |

Advanced Ops 是读写次数而非带宽。真要超，先砍 `/api/dashboard` 的读写合并次数，而不是砍指标。

## 8. 已知口径偏差

均已在 UI 内注明，不是 bug：

- **D1** 参考图仪表扇区按五等分绘制，与 25/45/56/76 阈值不符 → 本实现按真实阈值画。
- **D2** 参考图 RSI 三档未说明跨档处理 → 三期同档取该档，跨档取均值档并标「三期分歧」。
- **D3** 参考图正文「偏高」与图例「正常」冲突 → 统一 25 起为偏高。
- **D4** 恐贪底层是 S&P 500（CNN 口径），对 NDX 是代理指标。
- **D5** DXY 新浪 `fx_sdxy` 常空 → 六货币对自算并做偏差校验。
- **D6** 指数成交量是成分股合计，对价格指数无直接经济含义。
- **D7** 腾讯接口两套格式：美股 `200~` + `~` 分隔，期货纯逗号分隔且无状态位。曾统一按美股格式解析，导致原油/黄金**备源静默失效**（已修，有单测回归）。
- **D8** 蛋卷对 NDX 同时给 PE 分位 38.64% 与 PB 分位 74.48%，自家标签 `eva_type` 取「高估」。本面板 M4 只按 PE 分位判档（PRD 口径），所以结论是「合理」，与蛋卷标签不一致属正常分歧 —— ROE 31% 下 PB 高、PE 不高正是这种组合的原因。
- **D9** `pe_percentile` 的历史起点由蛋卷决定（`begin_at` = 2016-07），约 10.3 年，故 M4 标注「回望 10y」。
- **D10** 数据新鲜度按两种口径分别计算：盘中为上游快照延迟（约 15 分钟），其余时段为「距该交易日收盘多久」，周末会显示「2 天前」而不是「延迟 15 分钟」。

## 9. 未决

- 评分模型当前 `v1.0`（情绪/波动/估值/动量四维等权）。五维（含宏观）已在 `shared/compute/score.ts` 实现为 `v1.1`，待确认后改 `SCORE_MODEL` 一处即可。
- 环比波动口径、是否只做 NDX、评分参数是否采用反解默认值，见 TECH-001 的 Q5–Q8。
