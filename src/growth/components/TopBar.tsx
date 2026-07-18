import { useEffect, useRef, useState } from 'react'
import { Bell, Check, ChevronDown } from 'lucide-react'
import { useApp } from '../store'

export default function TopBar() {
  const { businesses, businessId, setBusinessId, isAllBusinesses, business, branding, approvals } = useApp()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  return (
    <header className="flex items-center justify-between rounded-2xl border border-slate-100 bg-white px-5 py-3 shadow-sm">
      <div className="flex min-w-0 items-center gap-3 text-[13.5px] text-slate-500">
        <span className="hidden shrink-0 sm:inline">Here's your overview for:</span>
        <div className="relative" ref={ref}>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[13.5px] font-bold text-ink shadow-sm hover:bg-slate-50"
          >
            <span className="grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-fuchsia-400 via-amber-300 to-emerald-400 text-[11px]">
              {isAllBusinesses ? '✦' : business.emoji}
            </span>
            {isAllBusinesses ? 'All Businesses' : business.name}
            <ChevronDown size={15} className="text-slate-400" />
          </button>
          {open && (
            <div className="absolute left-0 top-full z-30 mt-2 w-64 overflow-hidden rounded-xl border border-slate-100 bg-white py-1.5 shadow-xl">
              <button
                type="button"
                onClick={() => { setBusinessId('all'); setOpen(false) }}
                className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] font-semibold text-slate-600 hover:bg-slate-50"
              >
                <span className="grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-fuchsia-400 via-amber-300 to-emerald-400 text-[11px]">✦</span>
                All Businesses
                {isAllBusinesses && <Check size={14} className="ml-auto text-brand" strokeWidth={3} />}
              </button>
              <div className="my-1 border-t border-slate-100" />
              {businesses.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => { setBusinessId(b.id); setOpen(false) }}
                  className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] font-semibold text-slate-600 hover:bg-slate-50"
                >
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-slate-100 text-[13px]">{b.emoji}</span>
                  <span className="truncate">{b.name}</span>
                  {businessId === b.id && <Check size={14} className="ml-auto shrink-0 text-brand" strokeWidth={3} />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <span className="hidden text-xs font-bold text-slate-400 md:block">{branding.agencyName}</span>
        <button type="button" className="relative text-slate-400 hover:text-slate-600">
          <Bell size={18} />
          {approvals.length > 0 && (
            <span className="absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-orange-400 px-1 text-[9px] font-extrabold text-white">
              {approvals.length}
            </span>
          )}
        </button>
        <div className="grid h-9 w-9 place-items-center rounded-full bg-brand text-sm font-extrabold text-white">N</div>
      </div>
    </header>
  )
}
