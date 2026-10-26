/**
 * 溢出体检：用 CDP 打开页面，量真实布局宽度并列出越界元素。
 * 用法: node scripts/audit-overflow.mjs <url> <width>
 */
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const url = process.argv[2] ?? 'http://localhost:4173/'
const width = Number(process.argv[3] ?? 390)

const profile = mkdtempSync(join(tmpdir(), 'cdp-'))
const port = 9300 + Math.floor(Math.random() * 400)

const proc = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${width},3000`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  let ver
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (r.ok) { ver = await r.json(); break }
    } catch { /* 还没起来 */ }
    await sleep(250)
  }
  if (!ver) throw new Error('chrome 未就绪')

  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const tab = tabs.find((t) => t.type === 'page')
  const ws = new WebSocket(tab.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })

  let id = 0
  const pending = new Map()
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  }
  const send = (method, params = {}) =>
    new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width, height: 3000, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url })
  await sleep(5000)

  const expr = `(() => {
    const cw = document.documentElement.clientWidth;
    const vw = window.innerWidth;
    const body = document.body;
    const bad = [];
    const all = document.querySelectorAll('body *');
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && (r.right > cw + 0.5 || r.left < -0.5)) {
        bad.push({
          tag: el.tagName,
          cls: String(el.className || '').slice(0, 80),
          left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width),
          text: (el.textContent || '').trim().slice(0, 40),
        });
      }
    }
    return JSON.stringify({
      innerWidth: vw,
      clientWidth: cw,
      docScrollW: document.documentElement.scrollWidth,
      bodyScrollW: body.scrollWidth,
      bodyOverflowX: getComputedStyle(body).overflowX,
      panelCount: document.querySelectorAll('.panel').length,
      badCount: bad.length,
      bad: bad.slice(0, 15),
    }, null, 1);
  })()`

  const out = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
  console.log(out.result?.result?.value ?? JSON.stringify(out))

  if (process.env.CLICK) {
    // 点开所有 aria-expanded 折叠块，验证展开后不溢出、且面板确实变高
    const clicked = await send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: `(async () => {
        const btns = [...document.querySelectorAll('button[aria-expanded]')];
        const h = () => [...document.querySelectorAll('.panel')].map(e => Math.round(e.getBoundingClientRect().height));
        const before = { states: btns.map(b => b.getAttribute('aria-expanded')), heights: h() };
        btns.forEach(b => b.click());
        await new Promise(r => setTimeout(r, 400));
        const cw = document.documentElement.clientWidth;
        const over = [...document.querySelectorAll('body *')].filter(e => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && (r.right > cw + 0.5 || r.left < -0.5);
        });
        return JSON.stringify({
          count: btns.length,
          before,
          afterStates: btns.map(b => b.getAttribute('aria-expanded')),
          afterHeights: h(),
          overflowAfterExpand: over.length,
        }, null, 1);
      })()`,
    })
    console.log(clicked.result?.result?.value ?? JSON.stringify(clicked))
  }

  if (process.env.PANELS) {
    const rects = await send('Runtime.evaluate', {
      returnByValue: true,
      expression: `JSON.stringify([...document.querySelectorAll('.panel')].map((el,i) => {
        const r = el.getBoundingClientRect();
        const t = el.querySelector('h2');
        return { i, title: t ? t.textContent : '', top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), left: Math.round(r.left), w: Math.round(r.width) };
      }), null, 0)`,
    })
    console.log(rects.result?.result?.value ?? '')
  }

  // RECTS=<selector>：打印匹配元素的矩形，用于核对卡片等宽/对齐
  if (process.env.RECTS) {
    const sel = process.env.RECTS
    const rects = await send('Runtime.evaluate', {
      returnByValue: true,
      expression: `JSON.stringify([...document.querySelectorAll(${JSON.stringify(sel)})].map((el,i) => {
        const r = el.getBoundingClientRect();
        return { i, left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height), text: (el.textContent||'').trim().slice(0,20) };
      }), null, 0)`,
    })
    console.log(rects.result?.result?.value ?? '')
  }

  const shotPath = process.argv[4]
  if (shotPath) {
    const metrics = await send('Page.getLayoutMetrics')
    const h = Math.min(20000, Math.ceil(metrics.result.cssContentSize.height))
    await send('Emulation.setDeviceMetricsOverride', { width, height: h, deviceScaleFactor: 2, mobile: false })
    await sleep(600)
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
    const { writeFileSync } = await import('node:fs')
    writeFileSync(shotPath, Buffer.from(shot.result.data, 'base64'))
    console.log(`screenshot ${width}x${h} -> ${shotPath}`)
  }
  ws.close()
}

main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(() => { proc.kill() })
