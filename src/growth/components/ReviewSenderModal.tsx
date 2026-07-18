import { Link2, Mail } from 'lucide-react'
import { Modal, ModalClose } from './ui'

export default function ReviewSenderModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose} width="max-w-2xl">
      <div className="flex items-start justify-between px-6 pb-1 pt-5">
        <div>
          <p className="text-[16px] font-extrabold text-ink">Review Request Sender Configuration</p>
          <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-slate-500">
            I can send review requests either from your email or someone else's Google powered email, or infinite other
            ways like SMS or WhatsApp using our open integration.
          </p>
        </div>
        <ModalClose onClose={onClose} />
      </div>
      <div className="grid grid-cols-2 gap-4 p-6">
        <div className="rounded-xl border border-slate-200 p-5">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-brand-soft text-brand-deep">
            <Mail size={17} />
          </div>
          <p className="mt-3 text-[13.5px] font-extrabold text-ink">Ask via Email</p>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
            You can connect your own Google email or send this link to someone else to connect their inbox instead. This
            supports Gmail and Google Workspace email accounts.
          </p>
          <button type="button" className="mt-4 w-full rounded-lg bg-brand px-3 py-2.5 text-xs font-bold text-white hover:bg-brand-deep">
            Open Google Connection Link
          </button>
        </div>
        <div className="rounded-xl border border-slate-200 p-5">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-brand-soft text-brand-deep">
            <Link2 size={17} />
          </div>
          <p className="mt-3 text-[13.5px] font-extrabold text-ink">Ask via SMS, WhatsApp, or anything else!</p>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
            Anchor can integrate with any other system you're already using, such as Twilio, to ask for reviews via SMS.
            Simply configure Anchor's webhook to integrate with your existing tools.
          </p>
          <button type="button" className="mt-4 w-full rounded-lg bg-brand px-3 py-2.5 text-xs font-bold text-white hover:bg-brand-deep">
            Open Integration Configuration
          </button>
        </div>
      </div>
      <div className="flex justify-end border-t border-slate-100 px-6 py-4">
        <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-5 py-2 text-[13px] font-bold text-slate-600 hover:bg-slate-50">
          Close
        </button>
      </div>
    </Modal>
  )
}
