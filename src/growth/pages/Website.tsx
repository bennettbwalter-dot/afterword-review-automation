import { AlertCircle, CheckCircle2, Clock, Copy, ExternalLink } from 'lucide-react'
import { Card } from '../components/ui'
import { seoRows } from '../data/mock'

const widgets = [
  { name: 'Reviews carousel', desc: 'Show your latest Google reviews on your website as social proof.' },
  { name: 'Recent posts', desc: 'Turn your Google Business Posts into fresh website content.' },
  { name: 'Image gallery', desc: 'Display your approved profile images in a clean grid.' },
  { name: 'FAQs', desc: 'Embed the questions and answers Anchor maintains on your profile.' },
]

export default function Website() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-extrabold tracking-tight text-ink">Website</h1>

      <Card className="p-6">
        <h2 className="text-[15px] font-extrabold text-ink">On-page SEO scan</h2>
        <p className="mt-1 text-[13px] text-slate-500">
          What I detected on tylersroofing.com versus what I recommend for local search and AI visibility.
        </p>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
                <th className="pb-3 pr-4">Element</th>
                <th className="pb-3 pr-4">Detected on your site</th>
                <th className="pb-3 pr-4">Anchor's recommendation</th>
                <th className="pb-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {seoRows.map((r) => (
                <tr key={r.element}>
                  <td className="py-4 pr-4 align-top text-[13.5px] font-bold text-ink">{r.element}</td>
                  <td className="py-4 pr-4 align-top">
                    {r.status === 'ok' ? (
                      <span className="flex items-center gap-1.5 text-[12.5px] font-bold text-emerald-600">
                        <CheckCircle2 size={14} /> This is already optimized
                      </span>
                    ) : r.status === 'missing' ? (
                      <span className="flex items-center gap-1.5 text-[12.5px] font-bold text-red-500">
                        <AlertCircle size={14} /> I didn't detect this
                      </span>
                    ) : (
                      <span className="block max-w-xs text-[12.5px] leading-relaxed text-slate-500">{r.detected}</span>
                    )}
                  </td>
                  <td className="py-4 pr-4 align-top">
                    {r.status === 'ok' ? (
                      <span className="flex items-center gap-1.5 text-[12.5px] font-bold text-emerald-600">
                        <CheckCircle2 size={14} /> This is already optimized
                      </span>
                    ) : (
                      <span className="block max-w-sm text-[12.5px] leading-relaxed text-slate-600">{r.recommended}</span>
                    )}
                  </td>
                  <td className="py-4 align-top text-right">
                    <button type="button" className="rounded-lg border border-slate-200 p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-600">
                      {r.status === 'improve' ? <Copy size={14} /> : <ExternalLink size={14} />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-4 text-xs font-semibold text-slate-400">
          <Clock size={13} /> Last checked 1 day ago
          <button type="button" className="font-bold text-brand hover:underline">Check again now</button>
        </p>
      </Card>

      <Card className="p-6">
        <h2 className="text-[15px] font-extrabold text-ink">Embeddable widgets</h2>
        <p className="mt-1 text-[13px] text-slate-500">Drop these snippets into your website to reuse your Google profile activity.</p>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {widgets.map((w) => (
            <div key={w.name} className="rounded-xl border border-slate-100 p-5">
              <p className="text-[13.5px] font-extrabold text-ink">{w.name}</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">{w.desc}</p>
              <div className="mt-3 flex items-center gap-2">
                <code className="flex-1 truncate rounded-lg bg-slate-900 px-3 py-2.5 text-[11px] text-emerald-300">
                  {`<script src="https://widgets.abcagency.com/${w.name.toLowerCase().replace(/ /g, '-')}.js"></script>`}
                </code>
                <button type="button" className="rounded-lg border border-slate-200 p-2.5 text-slate-500 hover:bg-slate-50">
                  <Copy size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
