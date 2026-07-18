import { useState } from 'react'
import { Import, Sparkles } from 'lucide-react'
import { Modal } from './ui'

const tabs = ['New Note', 'Website Data', 'Personality']
const noteTypes = [
  'Posts', 'Review Replies', 'FAQs', 'Images', 'Service Descriptions',
  'Suggested Reviews', 'Video Narration', 'Video Description', 'GBP Audits',
]

export default function TrainAnchorModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState(0)
  const [type, setType] = useState(0)
  return (
    <Modal onClose={onClose} width="max-w-3xl">
      <div className="flex items-center gap-3 rounded-t-2xl bg-gradient-to-r from-brand to-[#6d7bfa] px-6 py-4 text-white">
        <Sparkles size={20} />
        <div>
          <p className="text-[15px] font-extrabold">Train Anchor</p>
          <p className="text-xs opacity-80">Add a training note and save to apply and re-use for your business profiles.</p>
        </div>
      </div>
      <div className="flex">
        <div className="w-44 shrink-0 space-y-1 border-r border-slate-100 p-4">
          {tabs.map((t, i) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(i)}
              className={`w-full rounded-lg px-3 py-2 text-left text-[13px] font-semibold ${
                i === tab ? 'bg-brand-soft text-brand-deep' : 'text-slate-500 hover:bg-slate-50'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="flex-1 p-6">
          <p className="text-[13.5px] font-bold text-ink">What is this training note for?</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {noteTypes.map((t, i) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(i)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                  i === type ? 'bg-brand text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <p className="mt-6 text-[13.5px] font-bold text-ink">
            What do you want me to do differently for {noteTypes[type].toLowerCase()}? I'll review it and suggest changes to ensure it's perfect.
          </p>
          <textarea
            className="mt-3 h-36 w-full resize-none rounded-xl border-2 border-brand/40 p-4 text-[13.5px] leading-relaxed text-slate-700 outline-none focus:border-brand"
            defaultValue={
              'If the post is for a Saturday, talk about how on Sunday (meaning tomorrow), you can come into our office for a free roof educational session.'
            }
          />
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-slate-100 px-6 py-4">
        <button type="button" className="flex items-center gap-2 text-[13px] font-bold text-slate-400 hover:text-slate-600">
          <Import size={15} /> Import Training Notes
        </button>
        <div className="flex gap-2.5">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-[13px] font-bold text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button type="button" onClick={onClose} className="rounded-lg bg-brand px-4 py-2 text-[13px] font-bold text-white hover:bg-brand-deep">
            Save
          </button>
        </div>
      </div>
    </Modal>
  )
}
