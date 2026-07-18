import { Link } from 'react-router-dom'
import { ArrowLeft, ChevronDown, Plus, Save, Trash2 } from 'lucide-react'
import { Card } from '../components/ui'
import { videoScenes, voiceoverScript } from '../data/mock'

function Thumb({ grad, emoji, size = 'h-20 w-28' }: { grad: string; emoji: string; size?: string }) {
  return (
    <div className={`grid ${size} shrink-0 place-items-center rounded-lg text-2xl`} style={{ background: grad }}>
      {emoji}
    </div>
  )
}

function SelectRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[13px] font-bold text-slate-600">{label}</span>
      <button type="button" className="flex w-64 items-center justify-between rounded-lg border border-slate-200 px-3.5 py-2.5 text-[13px] font-semibold text-ink hover:bg-slate-50">
        {value} <ChevronDown size={14} className="text-slate-400" />
      </button>
    </div>
  )
}

export default function VideoEditor() {
  return (
    <div className="space-y-5">
      <Link to="/dashboard" className="flex w-fit items-center gap-2 text-[13.5px] font-bold text-slate-600 hover:text-ink">
        <ArrowLeft size={16} /> Back to dashboard
      </Link>

      <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
        <div className="max-h-[75vh] space-y-4 overflow-y-auto pr-1">
          {videoScenes.map((s) => (
            <Card key={s.n} className="p-4">
              <p className="flex items-center gap-2 text-[13px] font-extrabold text-ink">
                Scene {s.n}
                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500">{s.time}</span>
              </p>
              <div className="mt-3 flex items-start gap-3">
                <Thumb grad={s.grad} emoji={s.emoji} />
                <div className="flex-1">
                  {s.overlay && (
                    <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                      <p className="flex items-center justify-between text-[10.5px] font-bold text-slate-400">
                        Text Overlay
                        <span>{s.overlay.time}</span>
                      </p>
                      <p className="mt-1 flex items-center justify-between gap-2 rounded-md bg-white px-2 py-1.5 text-xs font-semibold text-ink">
                        {s.overlay.text}
                        <Trash2 size={12} className="shrink-0 text-red-400" />
                      </p>
                    </div>
                  )}
                  <button type="button" className="mt-2 flex items-center gap-1 rounded-lg bg-brand px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-brand-deep">
                    <Plus size={12} /> Text Overlay
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>

        <Card className="flex flex-col p-6">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-2">
            <span className="pr-1 text-xs font-bold text-slate-400">Intro</span>
            {videoScenes.map((s) => (
              <Thumb key={s.n} grad={s.grad} emoji={s.emoji} size="h-14 w-20" />
            ))}
            <span className="pl-1 text-xs font-bold text-slate-400">Outro</span>
          </div>
          <div className="mt-3 flex items-center justify-between rounded-lg border-2 border-brand/50 px-4 py-2.5">
            <span className="text-[13px] font-bold text-brand">Voiceover</span>
            <span className="text-xs font-bold text-slate-400">0:00</span>
          </div>
          <div className="mt-5 space-y-4">
            <SelectRow label="Background Music" value="Power Grid" />
            <SelectRow label="Voice" value="Brooke" />
          </div>
          <p className="mt-6 text-[13px] font-bold text-slate-600">Voiceover script</p>
          <textarea
            className="mt-2 h-56 w-full resize-none rounded-xl border border-slate-200 p-4 text-[13px] leading-relaxed text-slate-700 outline-none focus:border-brand"
            defaultValue={voiceoverScript}
          />
          <div className="mt-5 flex justify-end">
            <button type="button" className="flex items-center gap-2 rounded-lg bg-brand px-5 py-2.5 text-[13px] font-bold text-white hover:bg-brand-deep">
              <Save size={15} /> Save
            </button>
          </div>
        </Card>
      </div>
    </div>
  )
}
