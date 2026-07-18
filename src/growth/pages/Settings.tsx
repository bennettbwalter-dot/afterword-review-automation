import { CheckCircle2, ChevronDown, PencilLine, RotateCcw, Upload } from 'lucide-react'
import { Card, Sparkline } from '../components/ui'
import { heatmapScale } from '../data/mock'
import { useApp } from '../store'

const swatches = ['#20707f', '#0ea5e9', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#232746']

export default function Settings() {
  const { branding, setBranding, resetDemo } = useApp()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">Settings</h1>
        <button
          type="button"
          onClick={resetDemo}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
        >
          <RotateCcw size={13} /> Reset demo data
        </button>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-5">
          <Card className="p-6">
            <h2 className="text-[15px] font-extrabold text-ink">Branding</h2>
            <p className="mt-1 text-[13px] text-slate-500">
              White-label the platform with your agency's identity. Changes apply everywhere immediately.
            </p>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-xs font-bold text-slate-500">Agency name</p>
                <input
                  value={branding.agencyName}
                  onChange={(e) => setBranding({ agencyName: e.target.value })}
                  className="mt-2 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-[13.5px] font-semibold text-ink outline-none focus:border-brand"
                />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-500">Rename your assistant</p>
                <input
                  value={branding.assistantName}
                  onChange={(e) => setBranding({ assistantName: e.target.value })}
                  className="mt-2 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-[13.5px] font-semibold text-ink outline-none focus:border-brand"
                />
              </div>
            </div>
            <div className="mt-4">
              <p className="text-xs font-bold text-slate-500">Agency logo</p>
              <button
                type="button"
                className="mt-2 flex w-full max-w-sm items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-200 px-3.5 py-2.5 text-[13px] font-bold text-slate-400 hover:border-brand hover:text-brand"
              >
                <Upload size={14} /> Upload logo
              </button>
            </div>
            <p className="mt-5 text-xs font-bold text-slate-500">Brand color</p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
              {swatches.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setBranding({ brandColor: c })}
                  className={`h-8 w-8 rounded-full transition-transform hover:scale-110 ${
                    branding.brandColor.toLowerCase() === c.toLowerCase() ? 'ring-2 ring-brand ring-offset-2' : ''
                  }`}
                  style={{ background: c }}
                />
              ))}
              <label className="ml-1 flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">
                Custom
                <input
                  type="color"
                  value={branding.brandColor}
                  onChange={(e) => setBranding({ brandColor: e.target.value })}
                  className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0"
                />
              </label>
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="text-[15px] font-extrabold text-ink">Heatmap color scale</h2>
            <p className="mt-1 text-[13px] text-slate-500">The ranking colors used in your client-facing geo-grid reports.</p>
            <div className="mt-4 space-y-2">
              {heatmapScale.map((s) => (
                <div key={s.range} className="flex items-center gap-3">
                  <span className="w-16 rounded-lg border border-slate-200 px-2 py-1.5 text-center text-xs font-bold text-slate-600">
                    {s.range}
                  </span>
                  <div className="h-4 flex-1 rounded-full" style={{ background: s.color }} />
                  <span className="w-20 text-right font-mono text-xs font-semibold text-slate-500">{s.color.toUpperCase()}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[15px] font-extrabold text-ink">Email</h2>
                <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
                  Set the sender name for emails or click here to customize all emails and have {branding.agencyName} send
                  them from your own inbox. <button type="button" className="font-bold text-brand hover:underline">here</button>
                </p>
              </div>
              <ChevronDown size={16} className="mt-1 shrink-0 text-slate-400" />
            </div>
            <p className="mt-4 text-xs font-bold text-slate-500">Email Sender Name</p>
            <input
              value={branding.senderName}
              onChange={(e) => setBranding({ senderName: e.target.value })}
              className="mt-2 w-full max-w-sm rounded-lg border border-slate-200 px-3.5 py-2.5 text-[13.5px] font-semibold text-ink outline-none focus:border-brand"
            />
          </Card>

          <Card className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[15px] font-extrabold text-ink">Custom Subdomain</h2>
                <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
                  Your clients can log in at <span className="font-bold text-brand">{branding.subdomain}/client-login</span>{' '}
                  and you can log in as the admin at <span className="font-bold text-brand">{branding.subdomain}</span>.
                </p>
              </div>
              <ChevronDown size={16} className="mt-1 shrink-0 text-slate-400" />
            </div>
            <div className="mt-4 flex max-w-sm items-center justify-between rounded-xl border border-slate-200 px-4 py-3">
              <span className="flex min-w-0 items-center gap-2 text-[13px] font-bold text-slate-600">
                <CheckCircle2 size={16} className="shrink-0 text-emerald-500" />
                <input
                  value={branding.subdomain}
                  onChange={(e) => setBranding({ subdomain: e.target.value })}
                  className="w-full bg-transparent outline-none"
                />
              </span>
              <PencilLine size={14} className="shrink-0 text-slate-400" />
            </div>
          </Card>
        </div>

        <Card className="sticky top-20 p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-extrabold text-ink">Preview</h2>
            <button type="button" className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600">
              Reports <ChevronDown size={13} className="text-slate-400" />
            </button>
          </div>
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-paper">
            <div className="flex items-center justify-between bg-white px-3 py-2">
              <span className="max-w-[40%] truncate text-[10px] font-extrabold uppercase text-brand">{branding.agencyName}</span>
              <span className="flex items-center gap-1 text-[8px] text-slate-400">
                Here's your overview for <span className="rounded-full bg-slate-100 px-1.5 py-0.5 font-bold">Sample Business</span>
              </span>
              <span className="h-3.5 w-3.5 rounded-full bg-slate-200" />
            </div>
            <div className="flex">
              <div className="w-16 space-y-1.5 border-r border-slate-100 bg-white p-2">
                {['Dashboard', 'Businesses', 'Automations', 'Reviews', 'Reports', 'Settings'].map((l, i) => (
                  <p key={l} className={`truncate rounded px-1.5 py-1 text-[7px] font-bold ${i === 4 ? 'bg-brand-soft text-brand-deep' : 'text-slate-400'}`}>
                    {l}
                  </p>
                ))}
              </div>
              <div className="flex-1 space-y-2 p-2.5">
                <p className="text-[9px] font-extrabold text-ink">Reports</p>
                <div className="rounded-md bg-[#46C283] px-2 py-1.5 text-[8px] font-extrabold text-white">
                  14 days until next audit
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-[8px] font-bold text-slate-500">Performance Reports</p>
                  <span className="rounded bg-brand px-1.5 py-0.5 text-[7px] font-bold text-white">+ Create Report</span>
                </div>
                <div className="grid grid-cols-[1.4fr_1fr] gap-2">
                  <div className="rounded-md border border-slate-200 bg-white p-1.5">
                    <Sparkline points={[3, 5, 4, 6, 5, 7, 6, 8]} color={branding.brandColor} height={34} dots={false} />
                  </div>
                  <div className="space-y-1.5">
                    <div className="rounded-md border border-slate-200 bg-white p-1.5">
                      <p className="text-[7px] text-slate-400">Search Views</p>
                      <p className="text-[9px] font-extrabold text-ink">2,543 <span className="text-emerald-500">+12%</span></p>
                    </div>
                    <div className="rounded-md border border-slate-200 bg-white p-1.5">
                      <p className="text-[7px] text-slate-400">Maps Views</p>
                      <p className="text-[9px] font-extrabold text-ink">1,892 <span className="text-emerald-500">+8%</span></p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <p className="mt-3 text-center text-[11px] font-semibold text-slate-400">
            This is what your clients see — fully branded as {branding.agencyName}.
          </p>
        </Card>
      </div>
    </div>
  )
}
