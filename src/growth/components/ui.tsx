import { useState, type ReactNode } from 'react'
import { Check, Copy, Sparkles, Star, X } from 'lucide-react'
import { mulberry32 } from '../data/mock'

export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`rounded-2xl border border-slate-100 bg-white shadow-[0_1px_2px_rgba(16,24,40,.05)] ${className}`}>
      {children}
    </div>
  )
}

export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={size}
          className={i <= Math.round(value) ? 'fill-amber-400 text-amber-400' : 'fill-slate-200 text-slate-200'}
        />
      ))}
    </span>
  )
}

export function Toggle({ defaultOn = false }: { defaultOn?: boolean }) {
  const [on, setOn] = useState(defaultOn)
  return (
    <button
      type="button"
      onClick={() => setOn(!on)}
      className={`h-6 w-11 shrink-0 rounded-full p-0.5 transition-colors ${on ? 'bg-brand' : 'bg-slate-300'}`}
    >
      <span className={`block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : ''}`} />
    </button>
  )
}

export function RadioGroup({ options, defaultIndex = 0, className = 'space-y-2.5' }: { options: ReactNode[]; defaultIndex?: number; className?: string }) {
  const [sel, setSel] = useState(defaultIndex)
  return (
    <div className={className}>
      {options.map((o, i) => (
        <label key={i} onClick={() => setSel(i)} className="flex cursor-pointer items-center gap-2.5 text-[13.5px] text-slate-700">
          <span className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border-2 ${i === sel ? 'border-brand' : 'border-slate-300'}`}>
            {i === sel && <span className="h-2 w-2 rounded-full bg-brand" />}
          </span>
          {o}
        </label>
      ))}
    </div>
  )
}

export function CheckboxLine({ label, defaultChecked = true, bold = false }: { label: ReactNode; defaultChecked?: boolean; bold?: boolean }) {
  const [c, setC] = useState(defaultChecked)
  return (
    <label onClick={() => setC(!c)} className={`flex cursor-pointer items-center gap-2.5 text-[13.5px] ${bold ? 'font-bold' : ''} text-slate-700`}>
      <span className={`grid h-[17px] w-[17px] shrink-0 place-items-center rounded ${c ? 'bg-brand' : 'border-2 border-slate-300 bg-white'}`}>
        {c && <Check size={12} className="text-white" strokeWidth={3.5} />}
      </span>
      {label}
    </label>
  )
}

export function Pill({ tone, children }: { tone: 'green' | 'orange' | 'red' | 'slate' | 'blue'; children: ReactNode }) {
  const tones: Record<string, string> = {
    green: 'bg-emerald-50 text-emerald-600',
    orange: 'bg-orange-50 text-orange-500',
    red: 'bg-red-50 text-red-500',
    slate: 'bg-slate-100 text-slate-500',
    blue: 'bg-brand-soft text-brand-deep',
  }
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${tones[tone]}`}>{children}</span>
}

export function Sparkline({ points, color = '#22C55E', height = 64, dots = true }: { points: number[]; color?: string; height?: number; dots?: boolean }) {
  const w = 240
  const h = 60
  const max = Math.max(...points)
  const min = Math.min(...points)
  const xy = points.map((p, i) => [
    (i / (points.length - 1)) * (w - 14) + 7,
    h - 8 - ((p - min) / (max - min || 1)) * (h - 18),
  ])
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      <polyline
        points={xy.map(([x, y]) => `${x},${y}`).join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {dots && xy.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={3} fill={color} />)}
    </svg>
  )
}

export function RadialGauge({ value, size = 88, stroke = '#F59E0B', track = 'rgba(255,255,255,.25)', text = 'text-white' }: { value: number; size?: number; stroke?: string; track?: string; text?: string }) {
  const r = (size - 12) / 2
  const c = 2 * Math.PI * r
  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={9} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={stroke}
          strokeWidth={9}
          fill="none"
          strokeDasharray={`${(value / 100) * c} ${c}`}
          strokeLinecap="round"
        />
      </svg>
      <span className={`text-lg font-extrabold ${text}`}>{value}%</span>
    </div>
  )
}

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
}

export function SemiGauge() {
  const arc = (a0: number, a1: number) => {
    const [x0, y0] = polar(60, 58, 44, a0)
    const [x1, y1] = polar(60, 58, 44, a1)
    return `M ${x0} ${y0} A 44 44 0 0 1 ${x1} ${y1}`
  }
  const [nx, ny] = polar(60, 58, 30, 196)
  return (
    <svg viewBox="0 0 120 68" className="h-full max-h-24">
      <path d={arc(180, 248)} stroke="#3ED598" strokeWidth={10} fill="none" strokeLinecap="round" />
      <path d={arc(256, 284)} stroke="#E7B93C" strokeWidth={10} fill="none" strokeLinecap="round" />
      <path d={arc(292, 360)} stroke="#3ED598" strokeWidth={10} fill="none" strokeLinecap="round" />
      <line x1={60} y1={58} x2={nx} y2={ny} stroke="#E7B93C" strokeWidth={3.5} strokeLinecap="round" />
      <circle cx={60} cy={58} r={6} fill="#E7B93C" />
      <text x={8} y={66} fill="#8b93b8" fontSize={8} fontWeight={700}>0</text>
      <text x={100} y={66} fill="#8b93b8" fontSize={8} fontWeight={700}>100</text>
    </svg>
  )
}

export function Modal({ onClose, children, width = 'max-w-2xl' }: { onClose: () => void; children: ReactNode; width?: string }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/45 p-6" onClick={onClose}>
      <div className={`max-h-[90vh] w-full ${width} overflow-y-auto rounded-2xl bg-white shadow-2xl`} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

export function ModalClose({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
      <X size={18} />
    </button>
  )
}

export function GreenBanner({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-center gap-3 rounded-xl bg-[#46C283] px-6 py-6 text-center text-[15px] font-extrabold text-white">
      <Sparkles size={18} className="shrink-0 opacity-80" />
      {children}
      <Sparkles size={18} className="shrink-0 opacity-80" />
    </div>
  )
}

export function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 truncate rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-[13px] font-medium text-brand-deep">
        {value}
      </div>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(value).catch(() => {})
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
        className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
      >
        <Copy size={13} /> {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  )
}

export function FacebookIcon({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="#1877f2">
      <path d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.77-3.89 1.09 0 2.23.2 2.23.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.44 2.89h-2.34v6.99A10 10 0 0 0 22 12z" />
    </svg>
  )
}

export function InstagramIcon({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="#e4405f" strokeWidth={2}>
      <rect x="2" y="2" width="20" height="20" rx="5.5" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="17.3" cy="6.7" r="1.2" fill="#e4405f" stroke="none" />
    </svg>
  )
}

export function LinkedinIcon({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="#0a66c2">
      <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.36V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.59 0 4.25 2.36 4.25 5.43v6.31zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.55C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.72C24 .77 23.2 0 22.22 0z" />
    </svg>
  )
}

export function YoutubeIcon({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="#ff0000">
      <path d="M23.5 6.19a3.02 3.02 0 0 0-2.12-2.14C19.5 3.55 12 3.55 12 3.55s-7.5 0-9.38.5A3.02 3.02 0 0 0 .5 6.19C0 8.07 0 12 0 12s0 3.93.5 5.81a3.02 3.02 0 0 0 2.12 2.14c1.87.5 9.38.5 9.38.5s7.5 0 9.38-.5a3.02 3.02 0 0 0 2.12-2.14C24 15.93 24 12 24 12s0-3.93-.5-5.81zM9.55 15.57V8.43L15.82 12l-6.27 3.57z" fill="#ff0000" />
      <path d="M9.55 15.57V8.43L15.82 12z" fill="#fff" />
    </svg>
  )
}

export function FakeQR({ size = 92 }: { size?: number }) {
  const rand = mulberry32(99)
  const n = 17
  const cells: ReactNode[] = []
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const corner = (r < 5 && c < 5) || (r < 5 && c >= n - 5) || (r >= n - 5 && c < 5)
      if (!corner && rand() < 0.45) {
        cells.push(<rect key={`${r}-${c}`} x={c} y={r} width={1} height={1} fill="#232746" />)
      }
    }
  }
  const finder = (x: number, y: number) => (
    <g key={`f${x}${y}`}>
      <rect x={x} y={y} width={5} height={5} fill="none" stroke="#232746" strokeWidth={1} />
      <rect x={x + 1.5} y={y + 1.5} width={2} height={2} fill="#232746" />
    </g>
  )
  return (
    <svg viewBox={`-1 -1 ${n + 2} ${n + 2}`} width={size} height={size} className="rounded-lg border border-slate-200 bg-white p-1">
      {cells}
      {finder(0.5, 0.5)}
      {finder(n - 5.5, 0.5)}
      {finder(0.5, n - 5.5)}
    </svg>
  )
}
