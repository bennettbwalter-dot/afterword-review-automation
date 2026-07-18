import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { businessProfiles, initialApprovals, initialFeed, type BusinessProfile } from './data/mock'

// ---------- color helpers ----------
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)]
}

function rgbToHex(r: number, g: number, b: number) {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')
}

function mix(hex: string, toward: string, amount: number) {
  const [r1, g1, b1] = hexToRgb(hex)
  const [r2, g2, b2] = hexToRgb(toward)
  return rgbToHex(r1 + (r2 - r1) * amount, g1 + (g2 - g1) * amount, b1 + (b2 - b1) * amount)
}

// ---------- types ----------
export type Branding = {
  agencyName: string
  assistantName: string
  brandColor: string
  subdomain: string
  senderName: string
}

export type Approval = {
  id: string
  kind: 'Video' | 'Google Post' | 'Review Reply'
  text: string
  detail: string
  to: string
}

export type FeedItem = { text: string; time: string; to: string }

type AppState = {
  branding: Branding
  setBranding: (patch: Partial<Branding>) => void
  businesses: BusinessProfile[]
  businessId: string
  setBusinessId: (id: string) => void
  business: BusinessProfile
  isAllBusinesses: boolean
  approvals: Approval[]
  approve: (id: string) => void
  feed: FeedItem[]
  resetDemo: () => void
}

const defaultBranding: Branding = {
  agencyName: 'ABC Agency',
  assistantName: 'Anchor',
  brandColor: '#20707f',
  subdomain: 'abcai.localmarketingsetup.com',
  senderName: 'ABC Agency',
}

const KEY = 'review-anchor-growth-v1'

const Ctx = createContext<AppState | null>(null)

function loadPersisted() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const saved = useMemo(loadPersisted, [])
  const [branding, setBrandingState] = useState<Branding>({ ...defaultBranding, ...(saved?.branding ?? {}) })
  const [businessId, setBusinessId] = useState<string>(saved?.businessId ?? 'all')
  const [approvals, setApprovals] = useState<Approval[]>(saved?.approvals ?? initialApprovals)
  const [feed, setFeed] = useState<FeedItem[]>(saved?.feed ?? initialFeed)

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ branding, businessId, approvals, feed }))
    } catch {
      /* storage unavailable — demo still works in-memory */
    }
  }, [branding, businessId, approvals, feed])

  // live white-label theming: override the Tailwind theme vars at the document root
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--growth-brand', branding.brandColor)
    root.style.setProperty('--growth-brand-deep', mix(branding.brandColor, '#000000', 0.2))
    root.style.setProperty('--growth-brand-soft', mix(branding.brandColor, '#ffffff', 0.9))
  }, [branding.brandColor])

  const setBranding = (patch: Partial<Branding>) => setBrandingState((b) => ({ ...b, ...patch }))

  const approve = (id: string) => {
    const item = approvals.find((a) => a.id === id)
    if (!item) return
    setApprovals((list) => list.filter((a) => a.id !== id))
    const verb = item.kind === 'Review Reply' ? 'Published review reply' : item.kind === 'Video' ? 'Published video' : 'Published post'
    setFeed((f) => [{ text: `${verb} — ${item.text}`, time: 'just now', to: item.to }, ...f])
  }

  const resetDemo = () => {
    setApprovals(initialApprovals)
    setFeed(initialFeed)
    setBrandingState(defaultBranding)
    setBusinessId('all')
  }

  const isAllBusinesses = businessId === 'all'
  const business = businessProfiles.find((b) => b.id === businessId) ?? businessProfiles[0]

  return (
    <Ctx.Provider
      value={{
        branding, setBranding,
        businesses: businessProfiles,
        businessId, setBusinessId, business, isAllBusinesses,
        approvals, approve, feed, resetDemo,
      }}
    >
      {children}
    </Ctx.Provider>
  )
}

export function useApp() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp must be used inside AppProvider')
  return v
}
