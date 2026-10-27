#!/usr/bin/env bash
# 手动触发数据抽取与计算：先日更（metrics.json）再盘中（latest.json）。
#
#   bash scripts/refresh.sh                # 常规：触发两个端点
#   FORCE=1 bash scripts/refresh.sh        # 穿透盘中幂等窗口，立即抓一次（每次多耗 1 次 Blob 写）
#   S=xxx PROXY= bash scripts/refresh.sh   # 换域名 / 禁用代理
#
# 服务器侧的其余闸门不因手动触发而放宽（这是刻意的，防双写 / 防空数据覆盖）：
#   skipped: off-hours     周末或每日 17:00–18:00 ET 维护时段——FORCE 也穿透不了，不写是正确行为
#   skipped: already-done  当天日更已跑过——同样算就绪
set -euo pipefail
cd "$(dirname "$0")/.."

S="${S:-https://ndx-dashboard-xi.vercel.app}"
K="$(grep -oP '(?<=^CRON_SECRET=).*' .env | tr -d '\r')"
if [ -z "$K" ]; then echo "错误：.env 里没有 CRON_SECRET"; exit 1; fi

# 本机连不上 *.vercel.app 时走本地代理；PROXY= 置空则直连
PROXY="${PROXY-}"
if [ -z "$PROXY" ] && netstat -an 2>/dev/null | grep -i LISTENING | grep -q ":20806 "; then
  PROXY="http://127.0.0.1:20806"
fi
CURL_ARGS=(--max-time 300 -sS)
[ -n "$PROXY" ] && CURL_ARGS+=(-x "$PROXY") && echo "走代理 $PROXY"

echo "=== 1/2 日更 GET /api/daily（约 5–10 s） ==="
curl "${CURL_ARGS[@]}" -X GET "$S/api/daily" -H "Authorization: Bearer $K" -w "\nHTTP %{http_code} in %{time_total}s\n"

echo "=== 2/2 盘中 POST /api/collect${FORCE:+（force）} ==="
curl "${CURL_ARGS[@]}" -X POST "$S/api/collect${FORCE:+?force=1}" -H "Authorization: Bearer $K" -w "\nHTTP %{http_code} in %{time_total}s\n"
