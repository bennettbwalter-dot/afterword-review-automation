import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle, ArrowLeft, ArrowRight, Check, ChevronRight, Info, Loader2, MapPin, Search, Sparkles, X,
} from 'lucide-react'
import { Card, RadialGauge, Stars } from '../components/ui'
import HeatmapGrid from '../components/HeatmapGrid'
import { aiModels, businessProfiles, genHeatmap, gridAverage, gridTop3Pct } from '../data/mock'
import { useApp } from '../store'

const steps = [
  'Finding your Google Business Profile…',
  'Checking 40+ profile ranking factors…',
  'Scanning your Google Maps ranking grid…',
  'Comparing you to your top 3 competitors…',
  'Asking 6 AI assistants if they recommend you…',
  'Writing your report…',
]

type AuditCheck = { label: string; pass: boolean; note: string }

export default function Audit() {
  const { branding } = useApp()
  const [phase, setPhase] = useState<'idle' | 'scanning' | 'done'>('idle')
  const [step, setStep] = useState(0)
  const [name, setName] = useState("Tyler's Roofing Co")
  const [city, setCity] = useState('Los Angeles, CA')

  // the audited business is matched by name, falling back to the first profile
  const b = useMemo(
    () => businessProfiles.find((p) => p.name.toLowerCase() === name.trim().toLowerCase()) ?? businessProfiles[0],
    [name],
  )

  const grid = useMemo(() => genHeatmap(b.heatSeedLatest, 3, 14), [b.heatSeedLatest])
  const avg = gridAverage(grid)
  const top3 = gridTop3Pct(grid)

  useEffect(() => {
    if (phase !== 'scanning') return
    if (step >= steps.length) {
      const t = setTimeout(() => setPhase('done'), 400)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setStep((s) => s + 1), 620)
    return () => clearTimeout(t)
  }, [phase, step])

  const run = () => {
    setStep(0)
    setPhase('scanning')
  }

  const checks: AuditCheck[] = [
    { label: 'Business description', pass: b.optimization > 60, note: b.optimization > 60 ? 'Present and keyword-rich' : 'Missing local keywords' },
    { label: 'Keyword optimization', pass: b.keywordPct >= 50, note: `${b.keywordPct}% of reviews contain keywords` },
    { label: 'Overall rating', pass: b.rating >= 4.6, note: `${b.rating.toFixed(1)}/5 — target is 4.6+` },
    { label: 'Review frequency', pass: b.reviewsPer90 >= 12, note: `${b.reviewsPer90} reviews in 90 days` },
    { label: 'Review response rate', pass: b.reviews > 0, note: b.reviews > 0 ? 'All reviews answered' : 'No reviews to answer yet' },
    { label: 'Image volume', pass: b.daysSinceImage <= 14, note: `Last upload ${b.daysSinceImage} days ago` },
    { label: 'Post frequency', pass: b.postsPer90 >= 18, note: `${b.postsPer90} posts in 90 days` },
    { label: 'Services & descriptions', pass: b.optimization > 70, note: b.optimization > 70 ? 'Complete' : 'Incomplete or thin' },
    { label: 'Service area set', pass: true, note: b.serviceAreas },
  ]
  const passed = checks.filter((c) => c.pass).length
  const score = Math.round((passed / checks.length) * 100)

  const opportunity = Math.round(b.monthlySearches * 0.032 * b.avgCustomerValue)
  const captured = Math.round(opportunity * (avg <= 5 ? 0.28 : 0.06))

  const fixes = [
    { pri: 'High', text: `Upload fresh photos — it has been ${b.daysSinceImage} days. Profiles with recent images rank measurably better.` },
    { pri: 'High', text: `Get review velocity up. You averaged ${(b.reviewsPer90 / 3).toFixed(1)} reviews a month; 4+ is the target.` },
    { pri: 'Medium', text: `Rewrite the business description to include "${b.keyword}" and your service areas naturally.` },
    { pri: 'Medium', text: 'Post to your profile at least once every 5 days, mixing updates, offers and photos.' },
    { pri: 'Low', text: 'Add structured schema markup to your website so search engines can parse your NAP details.' },
  ]

  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-slate-100 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="font-script text-[28px] font-bold leading-none text-brand">{branding.assistantName}</span>
            <span className="ml-1 rounded-full bg-brand-soft px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide text-brand-deep">
              Free audit
            </span>
          </div>
          <Link to="/dashboard" className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-ink">
            <ArrowLeft size={14} /> Back to dashboard
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-10">
        {phase === 'idle' && (
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-ink">
              See exactly why you're not ranking on Google Maps
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-slate-500">
              Get a free audit of your Google Business Profile — your ranking grid, your top 3 competitors, and the
              specific fixes that move you up. No credit card, takes about 60 seconds.
            </p>
            <Card className="mt-8 p-6 text-left">
              <label className="block text-xs font-bold text-slate-500">Business name</label>
              <div className="mt-2 flex items-center gap-2 rounded-xl border border-slate-200 px-3.5 py-3 focus-within:border-brand">
                <Search size={16} className="shrink-0 text-slate-400" />
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-transparent text-[14px] font-semibold text-ink outline-none"
                  placeholder="e.g. Tyler's Roofing Co"
                />
              </div>
              <label className="mt-4 block text-xs font-bold text-slate-500">City</label>
              <div className="mt-2 flex items-center gap-2 rounded-xl border border-slate-200 px-3.5 py-3 focus-within:border-brand">
                <MapPin size={16} className="shrink-0 text-slate-400" />
                <input
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full bg-transparent text-[14px] font-semibold text-ink outline-none"
                  placeholder="e.g. Los Angeles, CA"
                />
              </div>
              <button
                type="button"
                onClick={run}
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3.5 text-[14px] font-extrabold text-white shadow-lg shadow-brand/25 hover:bg-brand-deep"
              >
                Run my free audit <ArrowRight size={16} />
              </button>
              <p className="mt-3 text-center text-[11px] text-slate-400">
                Try any of: {businessProfiles.map((p) => p.name).join(' · ')}
              </p>
            </Card>
            <p className="mt-6 text-[11px] font-semibold text-slate-400">Powered by {branding.agencyName}</p>
          </div>
        )}

        {phase === 'scanning' && (
          <div className="mx-auto max-w-lg py-16">
            <div className="flex flex-col items-center">
              <Loader2 size={34} className="animate-spin text-brand" />
              <p className="mt-5 text-[15px] font-extrabold text-ink">Auditing {name}</p>
              <p className="mt-1 text-[13px] text-slate-400">{city}</p>
            </div>
            <div className="mt-8 space-y-2.5">
              {steps.map((s, i) => (
                <div
                  key={s}
                  className={`flex items-center gap-3 rounded-xl px-4 py-3 text-[13px] font-semibold transition-colors ${
                    i < step ? 'bg-emerald-50 text-emerald-700' : i === step ? 'bg-white text-ink shadow-sm' : 'text-slate-300'
                  }`}
                >
                  {i < step ? (
                    <Check size={15} className="shrink-0 text-emerald-500" strokeWidth={3} />
                  ) : i === step ? (
                    <Loader2 size={15} className="shrink-0 animate-spin text-brand" />
                  ) : (
                    <span className="h-[15px] w-[15px] shrink-0 rounded-full border-2 border-slate-200" />
                  )}
                  {s}
                </div>
              ))}
            </div>
          </div>
        )}

        {phase === 'done' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Audit report</p>
                <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-ink">{b.name}</h1>
                <p className="mt-1 text-[13px] text-slate-500">{b.category} · {b.city}</p>
              </div>
              <button
                type="button"
                onClick={() => { setPhase('idle'); setStep(0) }}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
              >
                Run another audit
              </button>
            </div>

            <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
              <Card className="flex flex-col items-center justify-center p-7 text-center">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Profile score</p>
                <div className="my-4">
                  <RadialGauge
                    value={score}
                    size={140}
                    stroke={score >= 70 ? '#22C55E' : score >= 40 ? '#F59E0B' : '#EF4444'}
                    track="#EEF0F6"
                    text="text-ink"
                  />
                </div>
                <p className="text-[13px] font-extrabold text-ink">
                  {score >= 70 ? 'Solid, with room to grow' : score >= 40 ? 'Needs attention' : 'Losing customers today'}
                </p>
                <p className="mt-1.5 text-[12px] leading-relaxed text-slate-500">
                  {passed} of {checks.length} ranking factors passed.
                </p>
              </Card>

              <Card className="p-6">
                <h2 className="text-[15px] font-extrabold text-ink">What we checked</h2>
                <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
                  {checks.map((c) => (
                    <div key={c.label} className="flex items-start gap-2.5 rounded-xl border border-slate-100 px-3.5 py-2.5">
                      <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full ${c.pass ? 'bg-emerald-500' : 'bg-red-500'}`}>
                        {c.pass ? <Check size={10} className="text-white" strokeWidth={4} /> : <X size={10} className="text-white" strokeWidth={4} />}
                      </span>
                      <div className="min-w-0">
                        <p className="text-[12.5px] font-bold text-ink">{c.label}</p>
                        <p className="truncate text-[11px] text-slate-400">{c.note}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            <Card className="p-6">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-[15px] font-extrabold text-ink">Where you rank across {b.city.split(',')[0]}</h2>
                  <p className="mt-1 text-[13px] text-slate-500">
                    Searching "<span className="font-bold text-ink">{b.keyword}</span>" from 143 points across your service area.
                  </p>
                </div>
                <div className="flex gap-6">
                  <div>
                    <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">Average position</p>
                    <p className="text-xl font-extrabold text-ink">{avg.toFixed(1)}</p>
                  </div>
                  <div>
                    <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">In the top 3</p>
                    <p className="text-xl font-extrabold text-ink">{top3.toFixed(1)}%</p>
                  </div>
                </div>
              </div>
              <div className="mt-5 grid gap-5 lg:grid-cols-[1.3fr_1fr]">
                <HeatmapGrid grid={grid} />
                <div>
                  <h3 className="text-[13.5px] font-extrabold text-ink">Your top competitor</h3>
                  <div className="mt-3 rounded-xl border border-slate-100 p-4">
                    <p className="text-[13px] font-extrabold text-ink">{b.competitor.name}</p>
                    <p className="mt-1 text-[11.5px] text-slate-400">{b.competitor.address}</p>
                    <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                      <Stars value={b.competitor.rating} size={12} /> {b.competitor.rating} · {b.competitor.reviews.toLocaleString()} reviews
                    </p>
                  </div>
                  <div className="mt-3 rounded-xl border border-orange-200 bg-orange-50/60 p-4">
                    <p className="text-[12px] font-semibold leading-relaxed text-slate-600">
                      They have <span className="font-extrabold text-ink">{(b.competitor.reviews - b.reviews).toLocaleString()} more reviews</span>{' '}
                      than you and post most weeks. That difference is most of the ranking gap.
                    </p>
                  </div>
                </div>
              </div>
            </Card>

            <Card className="p-6">
              <h2 className="text-[15px] font-extrabold text-ink">Do AI assistants recommend you?</h2>
              <p className="mt-1 text-[13px] text-slate-500">
                We asked each one for a {b.category.toLowerCase()} in {b.city}.
              </p>
              <div className="mt-4 grid gap-2.5 sm:grid-cols-3">
                {aiModels.map((m) => {
                  const found = b.aiVisibility[m]
                  return (
                    <div
                      key={m}
                      className={`flex items-center justify-between rounded-xl border px-4 py-3 ${
                        found ? 'border-emerald-100 bg-emerald-50/60' : 'border-slate-100 bg-slate-50/60'
                      }`}
                    >
                      <span className="text-[13px] font-bold text-ink">{m}</span>
                      <span className={`text-[11px] font-extrabold ${found ? 'text-emerald-600' : 'text-slate-400'}`}>
                        {found ? 'Found' : 'Not found'}
                      </span>
                    </div>
                  )
                })}
              </div>
              <p className="mt-4 flex gap-2 rounded-xl bg-slate-50 p-3.5 text-[11.5px] leading-relaxed text-slate-500">
                <Info size={14} className="mt-0.5 shrink-0 text-slate-400" />
                A single snapshot. These assistants answer differently by prompt, user, location and date — nobody outside
                the model providers controls what they recommend.
              </p>
            </Card>

            <Card className="p-6">
              <h2 className="text-[15px] font-extrabold text-ink">The opportunity</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs font-bold text-slate-400">Monthly local searches</p>
                  <p className="mt-1.5 text-2xl font-extrabold text-ink">{b.monthlySearches.toLocaleString()}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs font-bold text-slate-400">Assumed customer value</p>
                  <p className="mt-1.5 text-2xl font-extrabold text-ink">${b.avgCustomerValue.toLocaleString()}</p>
                </div>
                <div className="rounded-xl bg-emerald-50 p-4">
                  <p className="text-xs font-bold text-emerald-700">Est. monthly opportunity</p>
                  <p className="mt-1.5 text-2xl font-extrabold text-emerald-700">${opportunity.toLocaleString()}</p>
                </div>
              </div>
              <p className="mt-4 text-[13px] leading-relaxed text-slate-600">
                At your current average position of <span className="font-extrabold text-ink">{avg.toFixed(1)}</span>, you're
                capturing roughly <span className="font-extrabold text-ink">${captured.toLocaleString()}</span> of that.
              </p>
              <p className="mt-4 flex gap-2 rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 text-[11.5px] leading-relaxed text-slate-600">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />
                <span>
                  <span className="font-bold">These are estimates, not verified revenue.</span> They're modelled from
                  assumed search volume and an assumed customer value, and they don't account for your close rate,
                  capacity or margins. Treat them as a rough sense of scale.
                </span>
              </p>
            </Card>

            <Card className="p-6">
              <h2 className="text-[15px] font-extrabold text-ink">What to fix first</h2>
              <div className="mt-4 space-y-2.5">
                {fixes.map((f, i) => (
                  <div key={i} className="flex items-start gap-3 rounded-xl border border-slate-100 px-4 py-3">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-soft text-[11px] font-extrabold text-brand-deep">
                      {i + 1}
                    </span>
                    <p className="flex-1 text-[13px] leading-relaxed text-slate-600">{f.text}</p>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-extrabold ${
                        f.pri === 'High' ? 'bg-red-50 text-red-500' : f.pri === 'Medium' ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {f.pri}
                    </span>
                  </div>
                ))}
              </div>
            </Card>

            <div className="overflow-hidden rounded-2xl bg-gradient-to-r from-brand to-brand/80 p-8 text-center text-white">
              <Sparkles size={26} className="mx-auto opacity-80" />
              <h2 className="mt-3 text-xl font-extrabold">Want all of this handled automatically?</h2>
              <p className="mx-auto mt-2 max-w-lg text-[13.5px] leading-relaxed opacity-90">
                {branding.agencyName} can run the posts, photos, review requests and replies for you — and send you a
                report every month showing exactly how your ranking grid moved.
              </p>
              <Link
                to="/dashboard"
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-[14px] font-extrabold text-brand-deep hover:bg-white/90"
              >
                See how it works <ChevronRight size={16} />
              </Link>
            </div>

            <p className="pb-6 text-center text-[11px] font-semibold text-slate-400">
              Report generated by {branding.agencyName} · {b.serviceAreas}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
