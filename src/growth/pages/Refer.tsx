import { Gift } from 'lucide-react'
import { Card, CopyField } from '../components/ui'

export default function Refer() {
  return (
    <div className="mx-auto max-w-xl space-y-6 pt-8 text-center">
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-brand-soft text-brand">
        <Gift size={28} />
      </span>
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">Refer an agency!</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-slate-500">
          Know another agency that would love Anchor? Share your referral link — they get their first month of the Partner
          Program free, and you get a $100 credit when they subscribe.
        </p>
      </div>
      <Card className="p-6 text-left">
        <p className="text-xs font-bold text-slate-500">Your referral link</p>
        <div className="mt-2.5">
          <CopyField value="https://reviewanchor.app/r/abc-agency-x7k2" />
        </div>
        <p className="mt-4 text-xs font-semibold text-slate-400">3 agencies referred · $300 in credits earned</p>
      </Card>
    </div>
  )
}
