import { Link } from 'react-router-dom'
import { CheckCircle2, ChevronRight, Image, MessageSquare, PartyPopper, Video } from 'lucide-react'
import { Card } from '../components/ui'
import { useApp } from '../store'

const kindIcon = { Video, 'Google Post': Image, 'Review Reply': MessageSquare } as const

export default function Dashboard() {
  const { approvals, approve, feed, business, isAllBusinesses } = useApp()

  // when a single business is selected, only show work belonging to it
  const shortName = business.name.split(/['’]/)[0]
  const visibleApprovals = isAllBusinesses ? approvals : approvals.filter((a) => a.text.includes(shortName))
  const visibleFeed = isAllBusinesses ? feed : feed.filter((f) => f.text.includes(shortName))

  const half = Math.ceil(visibleFeed.length / 2)
  const cols = [visibleFeed.slice(0, half), visibleFeed.slice(half)]
  const count = visibleApprovals.length

  return (
    <div className="space-y-6">
      <div
        className={`relative overflow-hidden rounded-2xl px-8 py-8 text-white ${
          count > 0 ? 'bg-gradient-to-r from-[#f09a56] to-[#eb8640]' : 'bg-gradient-to-r from-[#3fbd82] to-[#34a875]'
        }`}
      >
        <p className="text-sm font-bold opacity-90">Hey Nick</p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight">
          {count > 0 ? "I'm waiting for your approval!" : "You're all caught up!"}
        </h1>
        <p className="mt-2 text-sm font-medium opacity-90">
          {count > 0
            ? `${count} item${count === 1 ? '' : 's'} need${count === 1 ? 's' : ''} a quick yes before I can publish.`
            : "Everything I've drafted is published. I'll keep working in the background."}
        </p>
        <div className="absolute right-10 top-1/2 hidden -translate-y-1/2 md:block">
          <div className="relative">
            <span className="grid h-24 w-24 place-items-center rounded-3xl bg-white/15 text-5xl">
              {count > 0 ? '🧑‍💻' : '🎉'}
            </span>
            {count > 0 && (
              <>
                <span className="absolute -left-4 -top-3 grid h-8 w-8 place-items-center rounded-full bg-white text-sm shadow-lg">❓</span>
                <span className="absolute -bottom-2 -right-3 grid h-8 w-8 place-items-center rounded-full bg-white text-sm shadow-lg">📊</span>
              </>
            )}
          </div>
        </div>
      </div>

      <Card className="p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-extrabold text-ink">Waiting for your approval</h2>
          {count > 0 && <span className="rounded-full bg-orange-50 px-2.5 py-1 text-xs font-bold text-orange-500">{count} pending</span>}
        </div>
        {count === 0 ? (
          <div className="mt-5 flex flex-col items-center gap-2 rounded-xl bg-emerald-50/70 py-9 text-center">
            <PartyPopper size={26} className="text-emerald-500" />
            <p className="text-[13.5px] font-extrabold text-emerald-700">Nothing waiting on you</p>
            <p className="text-xs text-emerald-600/80">
              {isAllBusinesses ? 'Approved work moves straight into your activity feed.' : `No pending items for ${business.name}.`}
            </p>
          </div>
        ) : (
          <div className="mt-4 divide-y divide-slate-100">
            {visibleApprovals.map((p) => {
              const Icon = kindIcon[p.kind]
              return (
                <div key={p.id} className="flex items-center gap-4 py-3.5">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-deep">
                    <Icon size={17} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-bold text-ink">{p.text}</p>
                    <p className="truncate text-xs text-slate-400">{p.detail}</p>
                  </div>
                  <Link
                    to={p.to}
                    className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
                  >
                    Review <ChevronRight size={13} />
                  </Link>
                  <button
                    type="button"
                    onClick={() => approve(p.id)}
                    className="rounded-lg bg-brand px-3.5 py-1.5 text-xs font-bold text-white hover:bg-brand-deep"
                  >
                    Approve
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <Card className="p-6">
        <h2 className="text-[15px] font-extrabold text-ink">
          Recent Automations{!isAllBusinesses && <span className="ml-2 text-xs font-bold text-slate-400">{business.name}</span>}
        </h2>
        {visibleFeed.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-slate-400">No activity recorded for this business yet.</p>
        ) : (
          <div className="mt-2 grid gap-x-12 md:grid-cols-2">
            {cols.map((col, ci) => (
              <div key={ci} className="divide-y divide-slate-100">
                {col.map((a, i) => (
                  <div key={`${ci}-${i}`} className="flex items-start gap-3 py-3.5">
                    <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-500" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-bold leading-snug text-ink">{a.text}</p>
                      <Link to={a.to} className="text-xs font-semibold text-brand underline-offset-2 hover:underline">
                        See details
                      </Link>
                    </div>
                    <span className="shrink-0 pt-0.5 text-xs text-slate-400">{a.time}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
