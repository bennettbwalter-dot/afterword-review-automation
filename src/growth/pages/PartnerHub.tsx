import { BadgeCheck } from 'lucide-react'
import { partnerPerks } from '../data/mock'

export default function PartnerHub() {
  return (
    <div className="space-y-7">
      <div className="text-center">
        <h1 className="text-[26px] font-extrabold tracking-tight text-ink">
          What's included in the Agency Partner Program subscription
        </h1>
        <p className="mt-2 text-[13.5px] font-semibold text-slate-500">$100 per agency per month · cancel anytime</p>
      </div>
      <div className="grid gap-x-10 gap-y-9 md:grid-cols-2 lg:grid-cols-3">
        {partnerPerks.map((p) => (
          <div key={p.title}>
            <BadgeCheck size={22} className="fill-brand text-white" />
            <h3 className="mt-2.5 text-[15px] font-extrabold text-brand-deep">{p.title}</h3>
            <p className="mt-2 text-[12.5px] leading-relaxed text-slate-500">
              {p.desc}{' '}
              <button type="button" className="font-bold text-brand underline underline-offset-2">Learn more</button>
            </p>
          </div>
        ))}
      </div>
      <div className="flex justify-center pt-2">
        <button type="button" className="rounded-xl bg-brand px-8 py-3 text-[14px] font-extrabold text-white shadow-lg shadow-brand/25 hover:bg-brand-deep">
          Manage your partnership
        </button>
      </div>
    </div>
  )
}
