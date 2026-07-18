import { ExternalLink, RefreshCw } from 'lucide-react'
import { Card, Pill } from '../components/ui'
import { directories } from '../data/mock'

function toneFor(status: string): 'green' | 'blue' | 'orange' {
  if (status === 'Live') return 'green'
  if (status === 'Syncing') return 'blue'
  return 'orange'
}

export default function Citations() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-extrabold tracking-tight text-ink">Citations</h1>

      <div className="rounded-2xl bg-gradient-to-r from-[#4053ee] to-[#5b6cf7] px-7 py-5 text-white">
        <p className="text-[15px] font-extrabold">Your business info is synced to 62 directories</p>
        <p className="mt-1 text-[12.5px] opacity-85">
          Directories power search engines and AI assistants. Any change to your Google Business Profile is automatically
          pushed everywhere, keeping your name, address and phone number consistent.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {[
          ['62', 'Connected directories'],
          ['48', 'Live listings'],
          ['2', 'Currently syncing'],
          ['98%', 'NAP consistency'],
        ].map(([v, l]) => (
          <Card key={l} className="p-5">
            <p className="text-2xl font-extrabold text-ink">{v}</p>
            <p className="mt-1 text-xs font-semibold text-slate-400">{l}</p>
          </Card>
        ))}
      </div>

      <Card className="p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-extrabold text-ink">Directory listings</h2>
          <button type="button" className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">
            <RefreshCw size={13} /> Sync all now
          </button>
        </div>
        <div className="mt-4 divide-y divide-slate-100">
          {directories.map((d) => (
            <div key={d.name} className="flex items-center gap-4 py-3.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-sm font-extrabold text-slate-500">
                {d.name[0]}
              </span>
              <p className="flex-1 text-[13.5px] font-bold text-ink">{d.name}</p>
              <span className="w-28 text-xs font-semibold text-slate-400">{d.synced}</span>
              <span className="w-32 text-right">
                <Pill tone={toneFor(d.status)}>{d.status}</Pill>
              </span>
              <button type="button" className="text-slate-300 hover:text-slate-500">
                <ExternalLink size={15} />
              </button>
            </div>
          ))}
        </div>
        <p className="mt-4 border-t border-slate-100 pt-4 text-xs font-semibold text-slate-400">
          You keep ownership of every citation created, even if you cancel.
        </p>
      </Card>
    </div>
  )
}
