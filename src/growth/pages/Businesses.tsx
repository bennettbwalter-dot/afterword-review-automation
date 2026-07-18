import { type ReactNode } from 'react'
import { Slash } from 'lucide-react'
import { FacebookIcon, InstagramIcon, RadialGauge, SemiGauge, Sparkline, Stars } from '../components/ui'
import { useApp } from '../store'
import { mulberry32 } from '../data/mock'

function ProgressItem({ label, pct, done }: { label: string; pct: number; done?: boolean }) {
  return (
    <div className="flex-1">
      <p className="flex items-center gap-2 text-xs font-bold text-white">
        <span className={`h-2 w-2 rounded-full ${done ? 'bg-emerald-300' : 'bg-white'}`} />
        {label}
        {!done && <span className="ml-auto font-extrabold">{pct}%</span>}
      </p>
      <div className="mt-2 h-2 rounded-full bg-white/25">
        <div className={`h-2 rounded-full ${done ? 'bg-emerald-300' : 'bg-white'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function AuditCard({ title, body, footer, warn = false, visual }: { title: string; body: string; footer: string; warn?: boolean; visual: ReactNode }) {
  return (
    <div className={`flex flex-col overflow-hidden rounded-2xl border ${warn ? 'border-peachline bg-peach' : 'border-slate-100 bg-white'}`}>
      <div className="p-4 pb-0">{visual}</div>
      <div className="flex-1 p-4">
        <h4 className="text-[14px] font-extrabold text-ink">{title}</h4>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-500">{body}</p>
      </div>
      <div className={`border-t px-4 py-2.5 text-xs font-semibold text-slate-400 ${warn ? 'border-peachline' : 'border-slate-100'}`}>
        {footer}
      </div>
    </div>
  )
}

function DarkTile({ children }: { children: ReactNode }) {
  return <div className="grid h-28 place-items-center rounded-xl bg-navy p-3">{children}</div>
}

export default function Businesses() {
  const { business: b } = useApp()

  // derive a stable 12-point trend from the business's review volume
  const rand = mulberry32(b.reviewsPer90 + b.name.length)
  const reviewTrend = Array.from({ length: 12 }, () => Math.round(rand() * Math.max(1, b.reviewsPer90 / 3)))
  const postTrend = Array.from({ length: 12 }, () => Math.round(1 + rand() * Math.max(1, b.postsPer90 / 4)))

  const lowReviews = b.reviewsPer90 < 12
  const lowRating = b.rating < 4.6
  const lowPosts = b.postsPer90 < 18
  const lowKeywords = b.keywordPct < 50
  const staleImages = b.daysSinceImage > 14
  const automatePct = Math.min(100, Math.round(b.optimization * 0.9 + 20))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-2xl bg-gradient-to-r from-brand to-brand/80 p-6 text-white">
        <div className="flex items-center gap-4">
          <span className="grid h-14 w-14 place-items-center rounded-xl bg-white/15 text-3xl">{b.emoji}</span>
          <div>
            <h1 className="text-xl font-extrabold">{b.name}</h1>
            <p className="mt-1 flex items-center gap-2 text-xs font-semibold opacity-90">
              <Stars value={b.rating} size={13} /> {b.rating.toFixed(1)}/5
              <span className="opacity-70">({b.reviews} Reviews)</span>
              <span className="opacity-70">· {b.category} · {b.city}</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-sm font-extrabold">Optimization rating</p>
            <p className="mt-0.5 max-w-[160px] text-xs opacity-80">Fully optimize your profile to rank higher</p>
          </div>
          <RadialGauge value={b.optimization} />
        </div>
      </div>

      <div className="flex items-center gap-8 rounded-2xl bg-brand px-6 py-4 text-white">
        <ProgressItem label="Configurations" pct={100} done />
        <ProgressItem label="Optimize Profile" pct={100} done />
        <ProgressItem label="Automate Everything" pct={automatePct} />
      </div>

      <div className="grid gap-4 pt-2 md:grid-cols-2 lg:grid-cols-3">
        <AuditCard
          warn={lowReviews}
          title="Recent Review Frequency"
          body={
            lowReviews
              ? `In the past 3 months, you failed to get at least 4 new reviews per month. You got ${b.reviewsPer90}.`
              : `Nice work — ${b.reviewsPer90} new reviews in the past 3 months is comfortably above the target of 12.`
          }
          footer="Go to Reviews tab"
          visual={<Sparkline points={reviewTrend} color={lowReviews ? '#e0a34f' : '#57c84d'} height={72} />}
        />
        <AuditCard
          warn={lowRating}
          title="Overall Google Rating"
          body={
            lowRating
              ? `Your overall Google rating is ${b.rating.toFixed(1)}/5. You must get this above 4.6/5 to rank higher.`
              : `Your overall Google rating is ${b.rating.toFixed(1)}/5 — above the 4.6 threshold Google rewards.`
          }
          footer="Go to Reviews tab"
          visual={
            <div className="grid h-[72px] place-items-center">
              <div className="text-center">
                <Stars value={b.rating} size={20} />
                <p className="mt-1 text-xs font-bold text-slate-400">({b.reviews} reviews)</p>
              </div>
            </div>
          }
        />
        <AuditCard
          warn={lowPosts}
          title="Post Frequency"
          body={
            lowPosts
              ? 'In the past 90 days, you have not posted the recommended amount, which is currently 1 every 5 days.'
              : `You've posted ${b.postsPer90} times in the past 90 days — right on the recommended cadence.`
          }
          footer={lowPosts ? 'This will fix itself over time' : 'Keep it up'}
          visual={<Sparkline points={postTrend} color="#4b7bec" height={72} />}
        />
        <AuditCard
          warn={lowKeywords}
          title="Review Keywords"
          body={`Only ${b.keywordPct}% of your reviews had keywords in them in the past 90 days. 50% is considered excellent. Make sure you're using our Suggested Reviews tool.`}
          footer="Go to Reviews tab"
          visual={
            <DarkTile>
              <SemiGauge />
            </DarkTile>
          }
        />
        <AuditCard
          warn={b.recentAvgRating < 4.5}
          title="Recent Google Ratings"
          body={`In the past 90 days your average Google review was ${b.recentAvgRating.toFixed(1)}/5. The goal is a 5.0.`}
          footer="Go to Reviews tab"
          visual={
            <DarkTile>
              <div className="text-center">
                <Stars value={b.recentAvgRating} size={18} />
                <p className="mt-1.5 text-xs font-bold text-slate-400">{b.recentAvgRating.toFixed(1)}/5</p>
              </div>
            </DarkTile>
          }
        />
        <AuditCard
          warn={staleImages}
          title="Image Uploads"
          body={`We ran out of images and need you to upload more ASAP. It's been ${b.daysSinceImage} days since I've been able to upload an image. Businesses that upload images every few days rank better.`}
          footer="Go to Images tab"
          visual={
            <DarkTile>
              <div className="w-full px-2">
                <p className="text-center text-xs font-extrabold text-white">Image Upload</p>
                <div className="mt-2.5 flex h-2.5 overflow-hidden rounded-full">
                  <div className="bg-emerald-400" style={{ width: `${Math.max(8, 100 - b.daysSinceImage * 1.6)}%` }} />
                  <div className="flex-1 bg-red-500" />
                </div>
                <p className="mt-2 text-center text-[10px] font-semibold text-red-400">
                  {b.daysSinceImage} days ago last picture uploaded
                </p>
              </div>
            </DarkTile>
          }
        />
        <AuditCard
          title="My Tasks"
          body="You have 1 task due. Completing tasks quickly keeps your automation running at full speed."
          footer="Go to Tasks"
          visual={
            <div className="overflow-hidden rounded-xl border border-slate-100">
              <div className="grid grid-cols-[1fr_1.2fr_auto] gap-2 bg-slate-50 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                <span>Due Date</span>
                <span>Task</span>
                <span>Action</span>
              </div>
              <div className="grid grid-cols-[1fr_1.2fr_auto] items-center gap-2 px-3 py-2.5 text-xs">
                <span className="font-semibold text-red-500">5 days ago</span>
                <span className="font-semibold text-ink">Approve Q&amp;A</span>
                <button type="button" className="rounded-md bg-brand px-2.5 py-1 text-[10px] font-bold text-white">Let's Go</button>
              </div>
            </div>
          }
        />
        <AuditCard
          title="Facebook not connected"
          body="Connect Facebook so I can repurpose your Google posts and keep your page active automatically."
          footer="Go to Settings"
          visual={
            <DarkTile>
              <div className="flex items-center gap-4 text-slate-400">
                <Slash size={30} />
                <FacebookIcon size={34} />
              </div>
            </DarkTile>
          }
        />
        <AuditCard
          title="Instagram not connected"
          body="Connect Instagram so I can cross-post your images and videos to keep your feed fresh."
          footer="Go to Settings"
          visual={
            <DarkTile>
              <div className="flex items-center gap-4 text-slate-400">
                <Slash size={30} />
                <InstagramIcon size={34} />
              </div>
            </DarkTile>
          }
        />
      </div>
    </div>
  )
}
