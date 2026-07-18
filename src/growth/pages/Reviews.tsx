import { useState } from 'react'
import { Download, PencilLine, QrCode, Send, Settings2 } from 'lucide-react'
import { Card, CopyField, FakeQR, GreenBanner, Stars } from '../components/ui'
import ReviewSenderModal from '../components/ReviewSenderModal'
import { pendingReviews } from '../data/mock'

function Stat({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <Card className="p-5">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-extrabold text-ink">{value}</p>
      {sub && <div className="mt-1.5">{sub}</div>}
    </Card>
  )
}

export default function Reviews() {
  const [senderOpen, setSenderOpen] = useState(false)
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-extrabold tracking-tight text-ink">Reviews</h1>

      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="Average rating" value="4.3" sub={<Stars value={4.3} size={13} />} />
        <Stat label="Total reviews" value="128" sub={<span className="text-xs font-semibold text-emerald-600">+9 this month</span>} />
        <Stat label="Response rate" value="100%" sub={<span className="text-xs font-semibold text-slate-400">Anchor replies for you</span>} />
        <Stat label="Requests sent" value="342" sub={<span className="text-xs font-semibold text-slate-400">Email · SMS · QR</span>} />
      </div>

      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-extrabold text-ink">Get more reviews</h2>
            <p className="mt-1 text-[13px] text-slate-500">
              Share your review link, print the QR code, or let me ask customers automatically.
            </p>
            <div className="mt-4 max-w-lg">
              <CopyField value="https://go.abcagency.com/r/tylers-roofing" />
            </div>
            <div className="mt-4 flex flex-wrap gap-2.5">
              <button type="button" className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">
                <Download size={13} /> Download QR
              </button>
              <button
                type="button"
                onClick={() => setSenderOpen(true)}
                className="flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-xs font-bold text-white hover:bg-brand-deep"
              >
                <Settings2 size={13} /> Review Request Sender Configuration
              </button>
            </div>
          </div>
          <div className="flex flex-col items-center gap-2">
            <FakeQR />
            <span className="flex items-center gap-1 text-[10.5px] font-bold text-slate-400">
              <QrCode size={11} /> Scan to review
            </span>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-[15px] font-extrabold text-ink">Anchor recommended replies for the following reviews</h2>
        <p className="mt-1 text-[13px] text-slate-500">You can edit each reply before approving.</p>
        <div className="mt-5 space-y-5">
          {pendingReviews.map((r) => (
            <div key={r.author} className="rounded-xl border border-slate-100 p-5">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-sm font-extrabold text-slate-500">
                  {r.author[0]}
                </span>
                <div>
                  <p className="text-[13.5px] font-bold text-ink">{r.author}</p>
                  <p className="flex items-center gap-2 text-xs text-slate-400">
                    <Stars value={r.rating} size={11} /> {r.time}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-[13px] leading-relaxed text-slate-600">{r.text}</p>
              <div className="mt-4 rounded-xl bg-brand-soft/60 p-4">
                <p className="text-[10.5px] font-bold uppercase tracking-wide text-brand-deep">✦ Anchor's suggested reply</p>
                <textarea
                  className="mt-2 h-20 w-full resize-none bg-transparent text-[13px] leading-relaxed text-slate-700 outline-none"
                  defaultValue={r.reply}
                />
              </div>
              <div className="mt-3 flex justify-end gap-2.5">
                <button type="button" className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">
                  <PencilLine size={13} /> Edit
                </button>
                <button type="button" className="flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-xs font-bold text-white hover:bg-brand-deep">
                  <Send size={13} /> Approve &amp; Post
                </button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-[15px] font-extrabold text-ink">See all reviews that you can flag with Google as being against T&amp;Cs</h2>
        <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-slate-500">
          These reviews might pass the test of being against Google's T&amp;Cs, which means you might be able to get them
          taken down. Anchor will remind you to flag these with Google later.
        </p>
        <div className="mt-5">
          <GreenBanner>None of your reviews are against Google's terms and conditions!</GreenBanner>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-[15px] font-extrabold text-ink">Reviews</h2>
        <p className="mt-1.5 text-[13px] text-slate-500">
          It's important to reply to your customer reviews. Below are the replies Anchor created for your current
          unanswered reviews.
        </p>
        <div className="mt-5">
          <GreenBanner>Great work — you've already replied to all your reviews!</GreenBanner>
        </div>
      </Card>

      {senderOpen && <ReviewSenderModal onClose={() => setSenderOpen(false)} />}
    </div>
  )
}
