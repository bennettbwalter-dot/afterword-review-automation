import { useMemo } from 'react'
import { Calendar, Check, ChevronDown, Flame, MousePointerClick, Navigation, Phone, Plus, X } from 'lucide-react'
import { Card, Stars } from '../components/ui'
import HeatmapGrid from '../components/HeatmapGrid'
import { aiModels, genHeatmap, gridAverage, gridTop3Pct } from '../data/mock'
import { useApp } from '../store'

function MiniStat({ icon: Icon, label, value }: { icon: typeof Phone; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-100 px-4 py-3.5">
      <div className="flex items-center gap-3">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-soft text-brand-deep">
          <Icon size={15} />
        </span>
        <span className="text-xs font-semibold text-slate-500">{label}</span>
      </div>
      <span className="text-lg font-extrabold text-ink">{value}</span>
    </div>
  )
}

export default function Reports() {
  const { business: b } = useApp()

  const baseline = useMemo(() => genHeatmap(b.heatSeedBaseline, 1, 27), [b.heatSeedBaseline])
  const latest = useMemo(() => genHeatmap(b.heatSeedLatest, 3, 7), [b.heatSeedLatest])

  const baseAvg = gridAverage(baseline)
  const lateAvg = gridAverage(latest)
  const improvement = ((baseAvg - lateAvg) / baseAvg) * 100
  const foundCount = aiModels.filter((m) => b.aiVisibility[m]).length

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-extrabold tracking-tight text-ink">Reports</h1>

      <div className="flex items-center justify-between rounded-2xl bg-[#46C283] px-7 py-6 text-white">
        <p className="text-xl font-extrabold">7 days until your next ranking audit!</p>
        <span className="text-4xl">🧑‍💻</span>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-extrabold text-ink">Performance Reports</h2>
        <div className="flex items-center gap-2.5">
          <button type="button" className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600">
            Reports <ChevronDown size={13} className="text-slate-400" />
          </button>
          <button type="button" className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600">
            Last 3 months <ChevronDown size={13} className="text-slate-400" />
          </button>
          <button type="button" className="flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-xs font-bold text-white hover:bg-brand-deep">
            <Plus size={14} /> Create Report
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.7fr_1fr]">
        <Card className="p-6">
          <div className="grid gap-6 md:grid-cols-[1fr_1.2fr]">
            <div className="flex flex-col">
              <p className="text-[13.5px] font-bold leading-snug text-ink">
                Lead actions since you started on <span className="rounded bg-fuchsia-100 px-1">07/09/25</span>:
              </p>
              <p className="my-auto py-4 text-6xl font-extrabold tracking-tight text-ink">{b.leadActions.toLocaleString()}</p>
              <span className="w-fit rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-600">
                $ Est. value ${b.estValue.toLocaleString()}
              </span>
            </div>
            <div className="space-y-3">
              <MiniStat icon={Phone} label="Lifetime calls" value={b.calls.toLocaleString()} />
              <MiniStat icon={Navigation} label="Lifetime direction requests" value={b.directions.toLocaleString()} />
              <MiniStat icon={MousePointerClick} label="Lifetime website clicks" value={b.clicks.toLocaleString()} />
            </div>
          </div>
          <p className="mt-4 border-t border-slate-100 pt-3 text-[11px] leading-relaxed text-slate-400">
            Estimated value assumes an average customer worth ${b.avgCustomerValue.toLocaleString()} and a typical conversion
            rate for {b.category.toLowerCase()}s. It is a projection, not verified revenue.
          </p>
        </Card>

        <Card className="p-6">
          <h3 className="text-[14px] font-extrabold text-ink">Top Competitor</h3>
          <div className="mt-4 flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-slate-100 text-xl">🏢</span>
            <div>
              <p className="text-[13px] font-extrabold leading-snug text-ink">{b.competitor.name}</p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-slate-400">{b.competitor.address}</p>
              <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                <Stars value={b.competitor.rating} size={12} /> {b.competitor.reviews.toLocaleString()} Google Reviews
              </p>
            </div>
          </div>
          <div className="mt-4 rounded-xl border border-orange-200 bg-orange-50/60 p-3.5 text-[12px] font-semibold leading-relaxed text-slate-600">
            There's an estimated <span className="font-extrabold text-ink">{b.monthlySearches.toLocaleString()} people</span>{' '}
            searching for this type of business near you every month.
          </div>
        </Card>
      </div>

      <div className="flex items-center justify-between pt-2">
        <h2 className="text-[15px] font-extrabold text-ink">Heatmap Audits</h2>
        <p className="text-xs font-semibold text-slate-500">
          <span className="mr-3 font-bold text-slate-400">Averages</span>
          Baseline: <span className="font-extrabold text-ink">{baseAvg.toFixed(1)}</span>
          <span className="mx-2 text-slate-300">|</span>
          Latest: <span className="font-extrabold text-ink">{lateAvg.toFixed(1)}</span>
          <span className="mx-2 text-slate-300">|</span>
          Change: <span className="font-extrabold text-emerald-600">{improvement.toFixed(1)}%</span>
        </p>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-[13px] font-bold text-ink">Keyword</span>
        <button type="button" className="rounded-lg bg-brand-soft px-3 py-1.5 text-[13px] font-bold text-brand-deep underline underline-offset-2">
          {b.keyword}
        </button>
        <button type="button" className="ml-auto grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500">
          <ChevronDown size={15} />
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <p className="text-[13px] font-extrabold text-ink">Baseline audit</p>
              <p className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                <Calendar size={12} /> {b.baselineDate}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">Average ranking</p>
              <p className="text-lg font-extrabold text-ink">{baseAvg.toFixed(1)}</p>
            </div>
            <div className="text-right">
              <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">Top 3 placements</p>
              <p className="text-lg font-extrabold text-ink">{gridTop3Pct(baseline).toFixed(2)}%</p>
            </div>
          </div>
          <HeatmapGrid grid={baseline} />
        </Card>
        <Card className="p-5">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <p className="flex items-center gap-1.5 text-[13px] font-extrabold text-emerald-600">
                Improvement {improvement.toFixed(2)}% <Flame size={14} className="text-orange-500" />
              </p>
              <p className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                <Calendar size={12} /> {b.latestDate}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">Average ranking</p>
              <p className="text-lg font-extrabold text-ink">{lateAvg.toFixed(1)}</p>
            </div>
            <div className="text-right">
              <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">Top 3 placements</p>
              <p className="text-lg font-extrabold text-ink">{gridTop3Pct(latest).toFixed(2)}%</p>
            </div>
          </div>
          <HeatmapGrid grid={latest} water />
        </Card>
      </div>

      <Card className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[15px] font-extrabold text-ink">AI visibility</h2>
            <p className="mt-1 text-[13px] text-slate-500">
              Whether {b.name} appeared when we asked each assistant for a {b.category.toLowerCase()} in {b.city}.
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-extrabold text-slate-600">
            {foundCount}/{aiModels.length} found
          </span>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {aiModels.map((m) => {
            const found = b.aiVisibility[m]
            return (
              <div
                key={m}
                className={`flex items-center justify-between rounded-xl border px-4 py-3 ${
                  found ? 'border-emerald-100 bg-emerald-50/60' : 'border-slate-100 bg-slate-50/60'
                }`}
              >
                <span className="text-[13.5px] font-bold text-ink">{m}</span>
                <span className={`flex items-center gap-1.5 text-xs font-extrabold ${found ? 'text-emerald-600' : 'text-slate-400'}`}>
                  {found ? <Check size={14} strokeWidth={3} /> : <X size={14} strokeWidth={3} />}
                  {found ? 'Found' : 'Not found'}
                </span>
              </div>
            )
          })}
        </div>
        <p className="mt-4 rounded-xl bg-slate-50 p-3.5 text-[11.5px] leading-relaxed text-slate-500">
          This is a single snapshot. AI assistants answer differently depending on the prompt, the user, their location and
          the date, so treat this as a directional signal rather than proof of persistent visibility.
        </p>
      </Card>
    </div>
  )
}
