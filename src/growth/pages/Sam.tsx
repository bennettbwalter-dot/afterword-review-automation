import { useState } from 'react'
import { ChevronDown, Mic, Phone, Sparkles, TrendingDown } from 'lucide-react'
import { Card, Pill, Stars } from '../components/ui'
import { samLeads, samObjections, samScript, type Lead } from '../data/mock'
import { useApp } from '../store'

const statuses: Lead['status'][] = ['New', 'Called', 'Interested', 'Closed', 'Not a fit']

const statusTone: Record<Lead['status'], 'slate' | 'blue' | 'green' | 'orange' | 'red'> = {
  New: 'blue',
  Called: 'slate',
  Interested: 'orange',
  Closed: 'green',
  'Not a fit': 'red',
}

export default function Sam() {
  const { branding } = useApp()
  const [leads, setLeads] = useState<Lead[]>(samLeads)
  const [activeId, setActiveId] = useState(samLeads[0].id)
  const [openObjection, setOpenObjection] = useState<number | null>(0)
  const [mockCall, setMockCall] = useState(false)

  const active = leads.find((l) => l.id === activeId) ?? leads[0]
  const worked = leads.filter((l) => l.status !== 'New').length

  const setStatus = (id: string, status: Lead['status']) =>
    setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, status } : l)))

  const fill = (t: string) =>
    t
      .replace(/{yourName}/g, 'Nick')
      .replace(/{agency}/g, branding.agencyName)
      .replace(/{industry}/g, active.industry.toLowerCase())
      .replace(/{city}/g, active.city)
      .replace(/{rank}/g, active.rank ? String(active.rank) : '20+')
      .replace(/{keyword}/g, `${active.industry.toLowerCase()} ${active.city.toLowerCase()}`)
      .replace(/{competitor}/g, active.competitor)
      .replace(/{price}/g, '$299')
      .replace(/{value}/g, '850')

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Sam</h1>
          <p className="mt-1 text-[13px] text-slate-500">
            Your AI sales assistant — enriched leads, a daily call queue, and scripts that have closed real deals.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-brand-soft px-3.5 py-2 text-xs font-extrabold text-brand-deep">
            {5 - worked > 0 ? `${5 - worked} free leads left today` : 'Daily free leads used'}
          </span>
          <button type="button" className="rounded-lg bg-brand px-4 py-2 text-xs font-bold text-white hover:bg-brand-deep">
            Get more leads
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {[
          ['5', 'Leads in today’s queue'],
          [String(worked), 'Worked today'],
          [String(leads.filter((l) => l.status === 'Interested').length), 'Interested'],
          [String(leads.filter((l) => l.status === 'Closed').length), 'Closed this week'],
        ].map(([v, l]) => (
          <Card key={l} className="p-5">
            <p className="text-2xl font-extrabold text-ink">{v}</p>
            <p className="mt-1 text-xs font-semibold text-slate-400">{l}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-extrabold text-ink">Today's call queue</h2>
            <div className="flex gap-2">
              <button type="button" className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600">
                All states <ChevronDown size={12} className="text-slate-400" />
              </button>
              <button type="button" className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600">
                All industries <ChevronDown size={12} className="text-slate-400" />
              </button>
            </div>
          </div>

          <div className="mt-4 space-y-2.5">
            {leads.map((l) => (
              <div
                key={l.id}
                onClick={() => setActiveId(l.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && setActiveId(l.id)}
                className={`cursor-pointer rounded-xl border p-4 transition-colors ${
                  l.id === activeId ? 'border-brand bg-brand-soft/40' : 'border-slate-100 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-lg">{l.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-bold text-ink">{l.business}</p>
                    <p className="truncate text-xs text-slate-400">
                      {l.industry} · {l.city}, {l.state}
                    </p>
                  </div>
                  <Pill tone={statusTone[l.status]}>{l.status}</Pill>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-3 border-t border-slate-100 pt-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Maps rank</p>
                    <p className="flex items-center gap-1 text-[13px] font-extrabold text-ink">
                      {l.rank ? (
                        <>
                          <TrendingDown size={12} className="text-red-500" /> #{l.rank}
                        </>
                      ) : (
                        'Not ranking'
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Reviews</p>
                    <p className="flex items-center gap-1.5 text-[13px] font-extrabold text-ink">
                      <Stars value={l.rating} size={10} /> {l.rating}
                      <span className="font-semibold text-slate-400">({l.reviews})</span>
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Beating them</p>
                    <p className="truncate text-[13px] font-extrabold text-ink">{l.competitor}</p>
                  </div>
                </div>
                {l.id === activeId && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                    <a
                      href={`tel:${l.phone.replace(/[^\d]/g, '')}`}
                      className="flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-xs font-bold text-white hover:bg-brand-deep"
                    >
                      <Phone size={13} /> {l.phone}
                    </a>
                    {statuses.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setStatus(l.id, s) }}
                        className={`rounded-lg px-2.5 py-2 text-xs font-bold ${
                          l.status === s ? 'bg-ink text-white' : 'border border-slate-200 text-slate-600 hover:bg-white'
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>

        <div className="space-y-5">
          <Card className="p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-extrabold text-ink">Call script</h2>
              <span className="truncate rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-500">
                {active.business}
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {samScript.map((s) => (
                <div key={s.label} className="rounded-xl border border-slate-100 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-brand-deep">{s.label}</p>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-600">{fill(s.text)}</p>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setMockCall(true)}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-brand px-4 py-2.5 text-[13px] font-bold text-brand hover:bg-brand-soft"
            >
              <Mic size={15} /> Practise on an AI mock call
            </button>
            {mockCall && (
              <div className="mt-3 rounded-xl bg-brand-soft/60 p-4">
                <p className="flex items-center gap-2 text-[12.5px] font-extrabold text-brand-deep">
                  <Sparkles size={14} /> Sam is role-playing {active.business}
                </p>
                <p className="mt-2 text-[12.5px] leading-relaxed text-slate-600">
                  "Yeah, this is the owner. Look, I get about four of these calls a week — what makes you different?"
                </p>
                <p className="mt-2.5 text-[11px] font-semibold text-slate-400">
                  Mock calls use your microphone and score your opener, discovery and close. Voice practice is simulated in
                  this build.
                </p>
                <button
                  type="button"
                  onClick={() => setMockCall(false)}
                  className="mt-3 text-[11px] font-bold text-brand hover:underline"
                >
                  End practice call
                </button>
              </div>
            )}
          </Card>

          <Card className="p-6">
            <h2 className="text-[15px] font-extrabold text-ink">Objection handling</h2>
            <p className="mt-1 text-[13px] text-slate-500">Tap an objection for a response that keeps the call alive.</p>
            <div className="mt-4 space-y-2">
              {samObjections.map((o, i) => (
                <div key={i} className="overflow-hidden rounded-xl border border-slate-100">
                  <button
                    type="button"
                    onClick={() => setOpenObjection(openObjection === i ? null : i)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-[12.5px] font-bold text-ink hover:bg-slate-50"
                  >
                    "{o.objection}"
                    <ChevronDown
                      size={14}
                      className={`shrink-0 text-slate-400 transition-transform ${openObjection === i ? 'rotate-180' : ''}`}
                    />
                  </button>
                  {openObjection === i && (
                    <p className="border-t border-slate-100 bg-slate-50/60 px-4 py-3 text-[12.5px] leading-relaxed text-slate-600">
                      {fill(o.rebuttal)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="text-[15px] font-extrabold text-ink">Coming soon</h2>
            <div className="mt-3 space-y-2">
              {['CRM integrations (HubSpot, Close, GoHighLevel)', 'Advanced script builder', 'Team leaderboards across reps'].map((t) => (
                <div key={t} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-2.5">
                  <span className="text-[12.5px] font-semibold text-slate-500">{t}</span>
                  <Pill tone="slate">Soon</Pill>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
