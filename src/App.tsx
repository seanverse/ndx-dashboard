import { NotReadyError, useDashboard } from './api/client'
import { ErrorState, NotReady, PageFooter, PageHeader, ScoreBar, Skeleton } from './components/Chrome'
import { M1Quote } from './components/M1Quote'
import { M2Gauge } from './components/M2Gauge'
import { M3Vxn } from './components/M3Vxn'
import { M4Valuation } from './components/M4Valuation'
import { M5Rsi } from './components/M5Rsi'
import { M6Score } from './components/M6Score'
import { M7Advice } from './components/M7Advice'
import { M8Macro } from './components/M8Macro'
import { POSITION_BY_RISK } from '../shared/compute'

export default function App() {
  const { data, error, isLoading, isFetching, refetch } = useDashboard()

  if (isLoading) return <Skeleton />
  if (error instanceof NotReadyError) return <NotReady />
  if (error) return <ErrorState message={error instanceof Error ? error.message : String(error)} />
  if (!data) return <Skeleton />

  const riskText = data.score ? `${POSITION_BY_RISK[data.score.riskLevel][0]}–${POSITION_BY_RISK[data.score.riskLevel][1]}%` : undefined

  return (
    <div className="min-h-screen">
      <ScoreBar data={data} onRefresh={() => void refetch()} refreshing={isFetching} />

      <main className="mx-auto max-w-[1200px] px-3 pb-4 sm:px-5">
        <PageHeader data={data} />

        {/*
          断点：≥1024 三栏 / 768–1023 两栏 / <768 单栏。
          重排规则：今日概览占两栏（数值最长），宏观三因子在宽屏独占一行（三张卡本身是横向的）。
        */}
        <div className="grid gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div className="md:col-span-2 lg:col-span-2">
            <M1Quote quote={data.quote} meta={data.meta} />
          </div>
          <M2Gauge fearGreed={data.fearGreed} />
          <M3Vxn vxn={data.vxn} />
          <M4Valuation valuation={data.valuation} />
          <M5Rsi rsi={data.rsi} />
          <div className="md:col-span-2 lg:col-span-3">
            <M8Macro macro={data.macro} />
          </div>
          {/*
            综合判断 + 操作建议：容器够放两个 ≥560px 的列时并排（视口 1200 = 内宽 1160），
            否则各自回落成整行、左右外沿与上方整行面板对齐。
            门槛用 min-[1200px] 而不是 xl(1280)：页面 max-w 是 1200，
            1280 之后内容宽不再变化，用 1280 会让 1200–1279 这段白白堆叠。
            不设 items-start：两格等高拉伸（底边对齐），多出的高度由各自内部
            flex-1 区块吸收，不在面板底部留空白带。
          */}
          <div className="md:col-span-2 lg:col-span-3">
            <div className="grid gap-3 sm:gap-4 min-[1200px]:grid-cols-2">
              <M6Score score={data.score} riskBandText={riskText} />
              <M7Advice advice={data.advice} score={data.score} />
            </div>
          </div>
        </div>
      </main>

      <PageFooter data={data} />
    </div>
  )
}
