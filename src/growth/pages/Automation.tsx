import { useState } from 'react'
import { Check, Settings2, Sparkles } from 'lucide-react'
import { Card, CheckboxLine, CopyField, FacebookIcon, GreenBanner, LinkedinIcon, RadioGroup, Toggle, YoutubeIcon } from '../components/ui'
import TrainAnchorModal from '../components/TrainAnchorModal'
import ReviewSenderModal from '../components/ReviewSenderModal'

const items = [
  { key: 'upload', label: 'Upload Images', on: true },
  { key: 'posting', label: 'Automate Posting', on: true },
  { key: 'reviews', label: 'Review Management', on: true },
  { key: 'videos', label: 'Automate Videos', on: true },
  { key: 'seo', label: 'Website & AI SEO', on: false },
  { key: 'manager', label: 'Account Manager', on: true },
  { key: 'reporting', label: 'Reporting', on: true },
  { key: 'summary', label: 'Summary', on: null },
]

function TrustBox({ question }: { question: string }) {
  return (
    <div className="rounded-xl bg-[#4c5ef7] p-5 text-white">
      <p className="flex items-center gap-2 text-[13.5px] font-extrabold">
        <Sparkles size={15} /> {question}
      </p>
      <p className="mt-3 flex items-center gap-2 text-[13px] font-extrabold">
        <span className="grid h-4 w-4 place-items-center rounded-sm bg-white">
          <Check size={11} className="text-[#4c5ef7]" strokeWidth={4} />
        </span>
        Trust Anchor
      </p>
      <p className="mt-1.5 pl-6 text-xs leading-relaxed opacity-85">
        Anchor updates this frequency automatically based on its analysis of over 1,000+ data points weekly. Trusting
        Anchor will help you rank higher faster.
      </p>
      <div className="my-3 ml-6 border-t border-white/25" />
      <p className="flex items-center gap-2 pl-0 text-[13px] font-semibold opacity-90">
        <span className="ml-6 h-4 w-4 rounded-sm border-2 border-white/70" />
        Set custom setting
      </p>
    </div>
  )
}

function ApprovalBlock({ subject }: { subject: string }) {
  return (
    <div className="rounded-xl border border-slate-100 p-5">
      <p className="text-[14px] font-extrabold text-ink">Approvals</p>
      <p className="mt-1 text-[13px] text-slate-500">Do you want to approve {subject} before I publish them?</p>
      <div className="mt-4">
        <RadioGroup options={['No', 'Only if the post uses a branded or AI-generated image', 'Yes']} defaultIndex={2} />
      </div>
      <div className="mt-5 border-t border-dashed border-slate-200 pt-4">
        <p className="text-[13px] font-bold text-ink">Who should I send this approval request to?</p>
        <div className="mt-3">
          <RadioGroup options={['Me (nicholas.bennett247@gmail.com)', 'Multiple people', 'Nobody']} defaultIndex={0} />
        </div>
        <div className="mt-4 flex items-center gap-2.5 text-[13px] font-semibold text-slate-600">
          <Toggle defaultOn />
          Do you want to see these tasks in your dashboard feed?
        </div>
      </div>
    </div>
  )
}

function AlertBlock({ title }: { title: string }) {
  return (
    <div className="rounded-xl border border-slate-100 p-5">
      <CheckboxLine label={title} bold />
      <p className="mt-3 text-[13px] font-bold text-ink">Who should this alert go to?</p>
      <div className="mt-2.5">
        <RadioGroup options={['Me (nicholas.bennett247@gmail.com)', 'Multiple people']} defaultIndex={0} />
      </div>
    </div>
  )
}

function ConnectCard({ icon, name, blurb }: { icon: React.ReactNode; name: string; blurb: string }) {
  return (
    <div className="rounded-xl border border-slate-100 p-5">
      <div className="flex items-start justify-between">
        {icon}
        <Toggle />
      </div>
      <p className="mt-3 text-[14px] font-extrabold text-ink">{name}</p>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">{blurb}</p>
      <div className="mt-4 flex gap-2">
        <button type="button" className="flex-1 rounded-lg bg-brand/85 px-3 py-2 text-xs font-bold text-white hover:bg-brand">
          Connect
        </button>
        <button type="button" className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-500 hover:bg-slate-50">
          Invite Link
        </button>
      </div>
    </div>
  )
}

export default function Automation() {
  const [panel, setPanel] = useState('upload')
  const [trainOpen, setTrainOpen] = useState(false)
  const [senderOpen, setSenderOpen] = useState(false)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">Automation</h1>
        <div className="flex w-72 items-center gap-3 rounded-xl bg-[#4053ee] px-4 py-2.5 text-white">
          <span className="text-xs font-bold">Automate Everything</span>
          <div className="h-2 flex-1 rounded-full bg-white/25">
            <div className="h-2 w-2/3 rounded-full bg-white" />
          </div>
          <span className="text-xs font-extrabold">66%</span>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
        <Card className="h-fit p-3">
          <p className="px-2.5 pb-2 pt-1 text-[13px] font-extrabold text-ink">Automation Settings</p>
          <div className="space-y-0.5">
            {items.map((i) => (
              <div
                key={i.key}
                role="button"
                tabIndex={0}
                onClick={() => setPanel(i.key)}
                onKeyDown={(e) => e.key === 'Enter' && setPanel(i.key)}
                className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-2.5 text-left text-[13px] font-semibold ${
                  panel === i.key ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {i.label}
                {i.on !== null && <Toggle defaultOn={i.on} />}
              </div>
            ))}
          </div>
        </Card>

        <div className="space-y-5">
          <Card className="flex items-center justify-between gap-4 p-5">
            <div>
              <p className="flex items-center gap-2 text-[14px] font-extrabold text-ink">
                <Sparkles size={15} className="text-brand" /> Train Anchor
              </p>
              <p className="mt-1 max-w-xl text-[12.5px] leading-relaxed text-slate-500">
                Training Anchor allows you to customize how Anchor writes Google Business Posts and the content within. By
                default, Anchor will use info from your website and best practices based on tracking thousands of data
                points when creating content.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setTrainOpen(true)}
              className="shrink-0 rounded-lg border-2 border-brand px-4 py-2 text-[13px] font-bold text-brand hover:bg-brand-soft"
            >
              Train Anchor
            </button>
          </Card>

          {panel === 'upload' && (
            <Card className="space-y-5 p-6">
              <div>
                <h2 className="text-[16px] font-extrabold text-ink">Automate Image Uploading</h2>
                <p className="mt-2 text-[13px] leading-relaxed text-slate-500">
                  When you upload images to Anchor, Anchor will analyze them and write a keyword-optimized description of
                  the image, rename the file using your keywords, plus geotag them for your target ranking area. Anchor
                  will then upload these images to your GBP's media section and use them for Google Business Posts. It's
                  important that you only upload images not already on your Google Business Profile.
                </p>
              </div>
              <TrustBox question="How often do you want to drip images onto your profile?" />
              <div>
                <p className="text-[13.5px] font-extrabold text-ink">You have 3 options to upload images:</p>
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <button type="button" className="rounded-xl bg-brand p-4 text-left text-white">
                    <p className="text-[13px] font-extrabold">Upload using link</p>
                    <p className="mt-1 text-[11px] opacity-80">Upload from the go using our upload link</p>
                  </button>
                  <button type="button" className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-left">
                    <p className="text-[13px] font-extrabold text-slate-400">Drag and Drop</p>
                    <p className="mt-1 text-[11px] text-slate-400">Upload images directly here</p>
                  </button>
                  <button type="button" className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-left">
                    <p className="text-[13px] font-extrabold text-slate-400">Integrations</p>
                    <p className="mt-1 text-[11px] text-slate-400">Upload via integration partners</p>
                  </button>
                </div>
              </div>
              <div>
                <p className="text-[13px] font-bold text-slate-600">🔗 Upload images using our image upload link</p>
                <div className="mt-2.5 max-w-xl">
                  <CopyField value="https://go.abcagency.com/u/tylers-roofing" />
                </div>
              </div>
            </Card>
          )}

          {panel === 'posting' && (
            <Card className="space-y-5 p-6">
              <h2 className="text-[16px] font-extrabold text-ink">Automate Google Posting</h2>
              <div className="rounded-xl border border-slate-100 p-5">
                <p className="text-[14px] font-extrabold text-ink">Image Styles</p>
                <p className="mt-1 text-[13px] text-slate-500">Do you want me to use your raw images or brand them with your logo &amp; text?</p>
                <div className="mt-4">
                  <RadioGroup options={['Only use raw images', 'Brand them all', 'Brand some of them']} defaultIndex={0} />
                </div>
              </div>
              <ApprovalBlock subject="posts" />
              <div className="rounded-xl border border-slate-100 p-5">
                <p className="text-[14px] font-extrabold text-ink">Social Media</p>
                <p className="mt-1 text-[13px] text-slate-500">I can repurpose your Google posts and publish them to your social channels too.</p>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <ConnectCard
                    icon={<FacebookIcon size={22} />}
                    name="Facebook"
                    blurb="I can publish these posts to your Facebook page."
                  />
                  <ConnectCard
                    icon={<LinkedinIcon size={22} />}
                    name="LinkedIn"
                    blurb="I can publish these posts to your LinkedIn page."
                  />
                </div>
              </div>
            </Card>
          )}

          {panel === 'reviews' && (
            <Card className="space-y-5 p-6">
              <h2 className="text-[16px] font-extrabold text-ink">Review Management</h2>
              <div className="flex items-center justify-between rounded-xl border border-slate-100 p-5">
                <div>
                  <p className="text-[14px] font-extrabold text-ink">Review request sender</p>
                  <p className="mt-1 text-[13px] text-slate-500">Choose how I ask your customers for reviews — email, SMS, WhatsApp or webhooks.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSenderOpen(true)}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-xs font-bold text-white hover:bg-brand-deep"
                >
                  <Settings2 size={13} /> Configure
                </button>
              </div>
              <p className="text-[13.5px] font-extrabold text-ink">Alerts</p>
              <AlertBlock title="You're not getting enough reviews" />
              <AlertBlock title="Doing great with reviews" />
              <AlertBlock title="Doing great with image uploading" />
            </Card>
          )}

          {panel === 'videos' && (
            <Card className="space-y-5 p-6">
              <h2 className="text-[16px] font-extrabold text-ink">Automate Video Creation &amp; Posting</h2>
              <TrustBox question="How often do you want to create and upload a new video?" />
              <div className="grid gap-3 md:grid-cols-2">
                <ConnectCard
                  icon={<LinkedinIcon size={22} />}
                  name="LinkedIn"
                  blurb="I can publish these videos to your LinkedIn page."
                />
                <ConnectCard
                  icon={<YoutubeIcon size={22} />}
                  name="YouTube"
                  blurb="I can upload these videos to your YouTube channel."
                />
              </div>
              <ApprovalBlock subject="videos" />
            </Card>
          )}

          {panel === 'seo' && (
            <Card className="space-y-4 p-6">
              <h2 className="text-[16px] font-extrabold text-ink">Website &amp; AI SEO</h2>
              <p className="text-[13px] leading-relaxed text-slate-500">
                I'll monitor your website for the on-page elements that local search and AI assistants look for — meta
                description, H1, schema markup, review widgets, image galleries, recent posts and FAQs — and tell you
                exactly what to fix. Turn this on and check the Website tab for the latest scan.
              </p>
              <div className="flex items-center gap-2.5 text-[13px] font-semibold text-slate-600">
                <Toggle /> Enable weekly website scans
              </div>
            </Card>
          )}

          {panel === 'manager' && (
            <Card className="space-y-4 p-6">
              <h2 className="text-[16px] font-extrabold text-ink">Account Manager</h2>
              <p className="text-[13px] leading-relaxed text-slate-500">
                I'll act as your account manager: watching performance data, adjusting your optimization strategy,
                recording every action I complete, and alerting you when important profile information changes.
              </p>
              <div className="flex items-center gap-2.5 text-[13px] font-semibold text-slate-600">
                <Toggle defaultOn /> Alert me when my business info changes on Google
              </div>
              <div className="flex items-center gap-2.5 text-[13px] font-semibold text-slate-600">
                <Toggle defaultOn /> Adjust strategy automatically based on performance
              </div>
            </Card>
          )}

          {panel === 'reporting' && (
            <Card className="space-y-4 p-6">
              <h2 className="text-[16px] font-extrabold text-ink">Reporting</h2>
              <p className="text-[13px] leading-relaxed text-slate-500">
                Recurring geo-grid ranking reports, weekly progress summaries and automated delivery to you or your
                clients.
              </p>
              <div className="flex items-center gap-2.5 text-[13px] font-semibold text-slate-600">
                <Toggle defaultOn /> Email me a weekly progress summary
              </div>
              <div className="flex items-center gap-2.5 text-[13px] font-semibold text-slate-600">
                <Toggle defaultOn /> Run a ranking audit every 14 days
              </div>
            </Card>
          )}

          {panel === 'summary' && (
            <Card className="space-y-5 p-6">
              <h2 className="text-[16px] font-extrabold text-ink">Summary</h2>
              <GreenBanner>Configurations &amp; profile optimization complete — automation is 66% set up!</GreenBanner>
              <ul className="space-y-2.5 text-[13.5px] font-semibold text-slate-600">
                <li className="flex items-center gap-2.5"><Check size={16} className="text-emerald-500" strokeWidth={3} /> Image uploading — automated</li>
                <li className="flex items-center gap-2.5"><Check size={16} className="text-emerald-500" strokeWidth={3} /> Google posting — automated with approvals</li>
                <li className="flex items-center gap-2.5"><Check size={16} className="text-emerald-500" strokeWidth={3} /> Review management — automated</li>
                <li className="flex items-center gap-2.5"><Check size={16} className="text-emerald-500" strokeWidth={3} /> Video creation — automated with approvals</li>
                <li className="flex items-center gap-2.5 text-slate-400"><span className="grid h-4 w-4 place-items-center rounded-full border-2 border-slate-300 text-[9px]" /> Website &amp; AI SEO — not enabled</li>
              </ul>
              <div className="flex justify-end">
                <button type="button" className="rounded-lg bg-brand px-5 py-2.5 text-[13px] font-bold text-white hover:bg-brand-deep">
                  Save &amp; Start Automation Setup
                </button>
              </div>
            </Card>
          )}
        </div>
      </div>

      {trainOpen && <TrainAnchorModal onClose={() => setTrainOpen(false)} />}
      {senderOpen && <ReviewSenderModal onClose={() => setSenderOpen(false)} />}
    </div>
  )
}
