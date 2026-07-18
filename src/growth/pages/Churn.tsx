import { AlertCircle, CheckCircle2, Search } from 'lucide-react'
import { Card, Stars, Toggle } from '../components/ui'
import { useApp } from '../store'

export default function Churn() {
  const { businesses, setBusinessId } = useApp()
  const rows = [...businesses].sort((a, b) => b.churnRisk - a.churnRisk)

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-extrabold tracking-tight text-ink">Churn Prevention</h1>
      <Card className="p-6">
        <div className="flex items-center justify-between gap-4">
          <p className="text-[13.5px] font-semibold text-slate-600">
            Spot at-risk clients before they cancel and prioritize the ones needing attention.
          </p>
          <label className="flex w-64 items-center gap-2 rounded-full border border-slate-200 px-3.5 py-2 text-slate-400">
            <Search size={14} />
            <input placeholder="Search" className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-slate-400" />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <span className="flex items-center gap-2.5 rounded-full bg-slate-50 px-4 py-2 text-[12.5px] font-semibold text-slate-600">
            <Toggle defaultOn />
            Notify <span className="underline decoration-slate-300 underline-offset-2">nicholas.bennett247@gmail.com</span> when a
            client is <span className="underline decoration-slate-300 underline-offset-2">50%</span>+ likely to churn
          </span>
          <span className="flex items-center gap-2.5 rounded-full bg-slate-50 px-4 py-2 text-[12.5px] font-semibold text-slate-600">
            <Toggle defaultOn />
            Create a task on the dashboard when the threshold is hit.
          </span>
        </div>

        <table className="mt-5 w-full">
          <thead>
            <tr className="text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
              <th className="pb-3 pr-4">Churn risk</th>
              <th className="pb-3 pr-4">Client</th>
              <th className="pb-3 pr-4">Onboarded since</th>
              <th className="pb-3 pr-4">Days since review</th>
              <th className="pb-3 pr-4">Images in queue</th>
              <th className="pb-3 text-right">Suggestions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => {
              const hot = r.churnRisk >= 50
              return (
                <tr key={r.id}>
                  <td className="py-4 pr-4">
                    <span className={`flex w-fit items-center gap-1.5 text-[15px] font-extrabold ${hot ? 'text-orange-500' : 'text-emerald-500'}`}>
                      {hot ? <AlertCircle size={17} /> : <CheckCircle2 size={17} />}
                      {r.churnRisk}%
                    </span>
                  </td>
                  <td className="py-4 pr-4">
                    <div className="flex items-center gap-3">
                      <span className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-lg">{r.emoji}</span>
                      <div>
                        <p className="text-[13.5px] font-bold text-ink">{r.name}</p>
                        <p className="flex items-center gap-1.5 text-xs text-slate-400">
                          <Stars value={r.rating} size={11} /> {r.rating.toFixed(1)}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="py-4 pr-4">
                    <p className="text-[13.5px] font-bold text-ink">{r.onboardedDays} days</p>
                    <p className="text-xs text-slate-400">Since onboarding</p>
                  </td>
                  <td className={`py-4 pr-4 ${hot ? 'bg-rose-50/70' : ''}`}>
                    <p className="px-2 text-[13.5px] font-bold text-ink">{r.daysSinceReview}</p>
                    <p className="px-2 text-xs text-slate-400">{r.keywordPct}% with keywords</p>
                  </td>
                  <td className={`py-4 pr-4 ${hot ? 'bg-rose-50/70' : ''}`}>
                    <p className="px-2 text-[13.5px] font-bold text-ink">{r.imagesQueued} queued</p>
                    <p className="px-2 text-xs text-slate-400">{r.daysSinceImage} days since last upload</p>
                  </td>
                  <td className="py-4 text-right">
                    <button
                      type="button"
                      onClick={() => setBusinessId(r.id)}
                      className="rounded-lg border border-slate-200 px-4 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
                    >
                      View
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
