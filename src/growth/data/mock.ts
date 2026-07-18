// ---------- deterministic pseudo-random ----------
export function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------- heatmaps ----------
export function rankColor(v: number): string {
  if (v <= 2) return '#00A82D'
  if (v <= 5) return '#5FC92E'
  if (v <= 10) return '#9BDB00'
  if (v <= 13) return '#FFCA00'
  if (v <= 15) return '#FFA100'
  if (v <= 17) return '#FF4C00'
  if (v <= 19) return '#FF000B'
  return '#000000'
}

export function genHeatmap(seed: number, base: number, spread: number, rows = 11, cols = 13): (number | null)[][] {
  const rand = mulberry32(seed)
  const grid: (number | null)[][] = []
  for (let r = 0; r < rows; r++) {
    const row: (number | null)[] = []
    for (let c = 0; c < cols; c++) {
      if (rand() < 0.04) {
        row.push(null)
        continue
      }
      const dx = c / (cols - 1) - 0.12
      const dy = (rows - 1 - r) / (rows - 1) - 0.15
      const d = Math.sqrt(dx * dx + dy * dy) / 1.25
      const v = Math.round(base + d * spread + (rand() - 0.5) * 3)
      row.push(Math.max(1, Math.min(24, v)))
    }
    grid.push(row)
  }
  return grid
}

export function gridAverage(grid: (number | null)[][]) {
  const vals = grid.flat().filter((v): v is number => v !== null)
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

export function gridTop3Pct(grid: (number | null)[][]) {
  const vals = grid.flat().filter((v): v is number => v !== null)
  return (vals.filter((v) => v <= 3).length / vals.length) * 100
}

// ---------- businesses ----------
export type AiModel = 'ChatGPT' | 'Claude' | 'Gemini' | 'Grok' | 'Llama' | 'Perplexity'

export type BusinessProfile = {
  id: string
  name: string
  emoji: string
  category: string
  city: string
  serviceAreas: string
  keyword: string
  rating: number
  reviews: number
  optimization: number
  // audit signals
  reviewsPer90: number
  recentAvgRating: number
  keywordPct: number
  daysSinceImage: number
  postsPer90: number
  imagesQueued: number
  daysSinceReview: string
  // reports
  leadActions: number
  calls: number
  directions: number
  clicks: number
  estValue: number
  heatSeedBaseline: number
  heatSeedLatest: number
  baselineDate: string
  latestDate: string
  competitor: { name: string; address: string; rating: number; reviews: number }
  monthlySearches: number
  avgCustomerValue: number
  aiVisibility: Record<AiModel, boolean>
  churnRisk: number
  onboardedDays: number
}

export const businessProfiles: BusinessProfile[] = [
  {
    id: 'tylers',
    name: "Tyler's Roofing Co",
    emoji: '🏠',
    category: 'Roofing contractor',
    city: 'Los Angeles, CA',
    serviceAreas: 'Los Angeles, Santa Monica, Pacific Palisades',
    keyword: 'roof repair los angeles',
    rating: 0,
    reviews: 0,
    optimization: 29,
    reviewsPer90: 0,
    recentAvgRating: 0,
    keywordPct: 0,
    daysSinceImage: 50,
    postsPer90: 2,
    imagesQueued: 0,
    daysSinceReview: '∞ days',
    leadActions: 1401,
    calls: 79,
    directions: 539,
    clicks: 783,
    estValue: 2101500,
    heatSeedBaseline: 7,
    heatSeedLatest: 11,
    baselineDate: 'Jan 12 2026',
    latestDate: 'Jul 2 2026',
    competitor: { name: 'Apex Roofing & Exteriors', address: '1600 Duane Ave, Santa Clara, CA 95054', rating: 5, reviews: 5 },
    monthlySearches: 355000,
    avgCustomerValue: 1500,
    aiVisibility: { ChatGPT: false, Claude: false, Gemini: true, Grok: false, Llama: false, Perplexity: true },
    churnRisk: 37,
    onboardedDays: 119,
  },
  {
    id: 'rizzys',
    name: "Rizzy's Burgers",
    emoji: '🍔',
    category: 'Hamburger restaurant',
    city: 'Austin, TX',
    serviceAreas: 'Austin, Round Rock, Cedar Park',
    keyword: 'best burger austin',
    rating: 5.0,
    reviews: 84,
    optimization: 88,
    reviewsPer90: 19,
    recentAvgRating: 4.9,
    keywordPct: 14,
    daysSinceImage: 40,
    postsPer90: 16,
    imagesQueued: 1,
    daysSinceReview: '1 days',
    leadActions: 4820,
    calls: 612,
    directions: 2904,
    clicks: 1304,
    estValue: 168700,
    heatSeedBaseline: 21,
    heatSeedLatest: 29,
    baselineDate: 'Feb 3 2026',
    latestDate: 'Jul 5 2026',
    competitor: { name: 'Smokehouse Burger Bar', address: '412 Congress Ave, Austin, TX 78701', rating: 4.6, reviews: 1240 },
    monthlySearches: 74000,
    avgCustomerValue: 32,
    aiVisibility: { ChatGPT: true, Claude: true, Gemini: true, Grok: true, Llama: false, Perplexity: true },
    churnRisk: 31,
    onboardedDays: 239,
  },
  {
    id: 'marys',
    name: "Mary's Flowers",
    emoji: '💐',
    category: 'Florist',
    city: 'Portland, OR',
    serviceAreas: 'Portland, Beaverton, Lake Oswego',
    keyword: 'flower delivery portland',
    rating: 3.3,
    reviews: 41,
    optimization: 54,
    reviewsPer90: 1,
    recentAvgRating: 3.1,
    keywordPct: 0,
    daysSinceImage: 33,
    postsPer90: 3,
    imagesQueued: 0,
    daysSinceReview: '1792 days',
    leadActions: 612,
    calls: 141,
    directions: 208,
    clicks: 263,
    estValue: 91800,
    heatSeedBaseline: 41,
    heatSeedLatest: 47,
    baselineDate: 'Jan 28 2026',
    latestDate: 'Jul 1 2026',
    competitor: { name: 'Rose City Blooms', address: '2201 NW Kearney St, Portland, OR 97210', rating: 4.8, reviews: 386 },
    monthlySearches: 28000,
    avgCustomerValue: 85,
    aiVisibility: { ChatGPT: false, Claude: false, Gemini: false, Grok: false, Llama: false, Perplexity: false },
    churnRisk: 64,
    onboardedDays: 713,
  },
  {
    id: 'rasta',
    name: 'Rasta Roofing Co',
    emoji: '🎨',
    category: 'Roofing contractor',
    city: 'Miami, FL',
    serviceAreas: 'Miami, Coral Gables, Hialeah',
    keyword: 'roof replacement miami',
    rating: 4.3,
    reviews: 129,
    optimization: 76,
    reviewsPer90: 2,
    recentAvgRating: 4.1,
    keywordPct: 0,
    daysSinceImage: 27,
    postsPer90: 7,
    imagesQueued: 17,
    daysSinceReview: '440 days',
    leadActions: 2240,
    calls: 318,
    directions: 690,
    clicks: 1232,
    estValue: 1344000,
    heatSeedBaseline: 61,
    heatSeedLatest: 67,
    baselineDate: 'Jan 9 2026',
    latestDate: 'Jun 30 2026',
    competitor: { name: 'Sunshine State Roofers', address: '780 NW 42nd Ave, Miami, FL 33126', rating: 4.7, reviews: 902 },
    monthlySearches: 121000,
    avgCustomerValue: 1200,
    aiVisibility: { ChatGPT: true, Claude: false, Gemini: true, Grok: false, Llama: false, Perplexity: false },
    churnRisk: 69,
    onboardedDays: 816,
  },
]

export const aiModels: AiModel[] = ['ChatGPT', 'Claude', 'Gemini', 'Grok', 'Llama', 'Perplexity']

// ---------- dashboard ----------
export const initialFeed = [
  { text: "Created video for Tyler's Roofing Co", time: '7 hours ago', to: '/video-editor' },
  { text: "Drafted Review Reply for Rizzy's Burgers", time: '19 hours ago', to: '/reviews' },
  { text: "Drafted Review Reply for Tyler's Roofing Co", time: '19 hours ago', to: '/reviews' },
  { text: "Created video for Rizzy's Burgers", time: '1 day ago', to: '/video-editor' },
  { text: "Published a post to Tyler's Google Business Profile", time: '2 days ago', to: '/automation' },
  { text: "Drafted Review Reply for Mary's Flowers", time: '2 days ago', to: '/reviews' },
  { text: 'Drafted Review Reply for Rasta Roofing Co', time: '3 days ago', to: '/reviews' },
  { text: "FAQs generated for Tyler's Roofing Co", time: '4 days ago', to: '/automation' },
  { text: "Uploaded image for Rizzy's Burgers", time: '8 days ago', to: '/automation' },
  { text: "Drafted Review Reply for Tyler's Roofing Co", time: '8 days ago', to: '/reviews' },
]

export const initialApprovals = [
  { id: 'a1', kind: 'Video' as const, text: "30-second promo video for Tyler's Roofing Co", detail: 'Voiceover: Brooke · Music: Power Grid', to: '/video-editor' },
  { id: 'a2', kind: 'Google Post' as const, text: "Weekend offer post for Rizzy's Burgers", detail: 'Includes branded image + call to action', to: '/automation' },
  { id: 'a3', kind: 'Review Reply' as const, text: "Reply to Dana W. (5★) for Mary's Flowers", detail: 'Positive tone · mentions same-day delivery', to: '/reviews' },
]

// ---------- reviews ----------
export const pendingReviews = [
  {
    author: 'Dana W.', rating: 5, time: '2 days ago',
    text: "Tyler's crew replaced our whole roof in two days. Spotless cleanup, fair price, and they walked us through every step.",
    reply: "Thank you so much, Dana! It was a pleasure helping you protect your home — we're thrilled the team left everything spotless. If you ever need an inspection after a storm, we're one call away. — Tyler's Roofing Co",
  },
  {
    author: 'Marcus L.', rating: 4, time: '5 days ago',
    text: 'Solid work on our flat roof repair. Took a day longer than quoted but the result looks great and no more leaks.',
    reply: "Thanks for the honest feedback, Marcus — glad the repair is holding up leak-free! You're right that we ran a day over and we appreciate your patience. Enjoy the dry ceilings, and we're here if you need anything. — Tyler's Roofing Co",
  },
]

// ---------- citations ----------
export const directories = [
  { name: 'Google Business Profile', status: 'Live', synced: 'Today' },
  { name: 'Apple Maps', status: 'Live', synced: 'Today' },
  { name: 'Bing Places', status: 'Live', synced: 'Yesterday' },
  { name: 'Yelp', status: 'Live', synced: '2 days ago' },
  { name: 'Facebook', status: 'Syncing', synced: 'In progress' },
  { name: 'Foursquare', status: 'Live', synced: '3 days ago' },
  { name: 'Nextdoor', status: 'Live', synced: '3 days ago' },
  { name: 'Yellow Pages', status: 'Action needed', synced: '12 days ago' },
  { name: 'TripAdvisor', status: 'Live', synced: '4 days ago' },
  { name: 'Better Business Bureau', status: 'Live', synced: '5 days ago' },
  { name: 'Angi', status: 'Syncing', synced: 'In progress' },
  { name: 'Houzz', status: 'Live', synced: '6 days ago' },
]

// ---------- website SEO ----------
export const seoRows = [
  {
    element: 'Meta description',
    detected: "Tyler's Roofing — roof repair in Los Angeles.",
    recommended: "Tyler's Roofing Co: roof repair & replacement in Los Angeles, Santa Monica & Pacific Palisades. Trusted local roofers. Free estimates.",
    status: 'improve',
  },
  {
    element: 'H1',
    detected: 'Welcome to our website',
    recommended: 'Trusted Roof Repair & Replacement in Los Angeles, Santa Monica & Pacific Palisades',
    status: 'improve',
  },
  { element: 'Structured schema markup', detected: null, recommended: 'Add to HEAD section of website.', status: 'missing' },
  { element: 'Reviews', detected: 'ok', recommended: 'ok', status: 'ok' },
  { element: 'Image gallery', detected: null, recommended: 'Embed this widget on your website.', status: 'missing' },
  { element: 'Recent posts', detected: null, recommended: 'Embed this widget on your website.', status: 'missing' },
  { element: 'FAQs', detected: null, recommended: 'Embed this widget on your website.', status: 'missing' },
]

// ---------- settings ----------
export const heatmapScale = [
  { range: '1 – 2', color: '#00A82D' },
  { range: '3 – 5', color: '#5FC92E' },
  { range: '6 – 10', color: '#9BDB00' },
  { range: '11 – 13', color: '#FFCA00' },
  { range: '14 – 15', color: '#FFA100' },
  { range: '16 – 17', color: '#FF4C00' },
  { range: '18 – 19', color: '#FF000B' },
  { range: '20+', color: '#000000' },
]

// ---------- partner hub ----------
export const partnerPerks = [
  { title: '$100 in Sam credits (AI Sales Tool)', desc: 'Sam is our AI sales assistant designed to help marketing agencies grow 10x faster with data-enriched leads, daily call queues, and proven calling scripts.' },
  { title: 'Marketing & training materials', desc: 'Get access to proven-to-work sales, marketing, and agency growth training materials you can use to sell more Google Business Profile optimization services.' },
  { title: 'Weekly Sales Coaching Calls', desc: 'Join weekly agency sales coaching calls to learn from an agency sales veteran about the best ways to structure your sale and offerings to close more deals faster.' },
  { title: '$100 in heatmap audit credits', desc: 'Use the heatmap rank audit tool to show your prospective clients where they are currently ranking on Google Maps. Partners get $100 in free credits monthly.' },
  { title: '$100 in GBP audit lead magnets', desc: 'Get new clients on autopilot by adding a white-label GBP Audit tool to your website. It gives leads a cutting-edge GBP audit report that sells them your services.' },
  { title: '50% Off Citation Management', desc: 'Partners save 50% on citation management software, bringing the price down from $40 to $20 per month per GBP. If you have 5+ clients it pays for itself.' },
  { title: '50% Off Reputation Management', desc: 'Save 50% on reputation management software, bringing the price down from $50 to $25 per month per GBP for every client you manage.' },
  { title: 'Partner Community Access', desc: 'Join the partner-exclusive community on Skool and connect with hundreds of agencies growing with the same playbook.' },
  { title: 'Exclusive Partner Hangouts', desc: 'Get access to bi-weekly partner hangouts with US-based GBP and local SEO specialists, plus priority support for your whole team.' },
]

// ---------- video editor ----------
export const videoScenes = [
  { n: 1, time: '0:00 – 0:04', grad: 'linear-gradient(135deg,#fbbf24,#ea580c)', emoji: '🏚️', overlay: null },
  { n: 2, time: '0:04 – 0:09', grad: 'linear-gradient(135deg,#60a5fa,#1d4ed8)', emoji: '🔨', overlay: null },
  { n: 3, time: '0:09 – 0:12', grad: 'linear-gradient(135deg,#94a3b8,#334155)', emoji: '🧰', overlay: null },
  { n: 4, time: '0:12 – 0:16', grad: 'linear-gradient(135deg,#f59e0b,#b45309)', emoji: '🏗️', overlay: { time: '0:15 – 0:16', text: 'Built to last' } },
  { n: 5, time: '0:16 – 0:21', grad: 'linear-gradient(135deg,#fde68a,#f97316)', emoji: '🌇', overlay: { time: '0:17 – 0:19', text: 'A Roofer You Can Trust' } },
  { n: 6, time: '0:21 – 0:24', grad: 'linear-gradient(135deg,#34d399,#059669)', emoji: '🏡', overlay: null },
]

export const voiceoverScript = `Los Angeles weather can punish a roof fast.
Tyler's Roofing keeps homes protected in Los Angeles, Santa Monica, and Pacific Palisades.
Leaks after rain?
Shingles lifting in the wind?
We handle repairs, replacements, and clean installs that look sharp.
Clear estimates, tidy crews, and updates you can trust.
If your roof is aging, don't wait for the next storm to decide.
Call Tyler's Roofing Co today.`

// ---------- Sam: agency sales platform ----------
export type Lead = {
  id: string
  business: string
  emoji: string
  city: string
  state: string
  industry: string
  rank: number | null
  rating: number
  reviews: number
  competitor: string
  phone: string
  status: 'New' | 'Called' | 'Interested' | 'Closed' | 'Not a fit'
}

export const samLeads: Lead[] = [
  { id: 'l1', business: 'Redwood Plumbing', emoji: '🔧', city: 'Sacramento', state: 'CA', industry: 'Plumber', rank: 18, rating: 3.9, reviews: 47, competitor: 'Delta Drain Pros', phone: '(916) 555-0142', status: 'New' },
  { id: 'l2', business: 'Bright Smile Dental', emoji: '🦷', city: 'Mesa', state: 'AZ', industry: 'Dentist', rank: 12, rating: 4.4, reviews: 212, competitor: 'Valley Dental Group', phone: '(480) 555-0188', status: 'New' },
  { id: 'l3', business: 'Iron Peak Gym', emoji: '🏋️', city: 'Denver', state: 'CO', industry: 'Gym', rank: null, rating: 4.1, reviews: 63, competitor: 'Summit Fitness', phone: '(303) 555-0119', status: 'Called' },
  { id: 'l4', business: 'Coastal Law Group', emoji: '⚖️', city: 'Tampa', state: 'FL', industry: 'Law firm', rank: 7, rating: 4.8, reviews: 91, competitor: 'Bayshore Legal', phone: '(813) 555-0173', status: 'Interested' },
  { id: 'l5', business: 'Green Thumb Landscaping', emoji: '🌿', city: 'Raleigh', state: 'NC', industry: 'Landscaper', rank: 21, rating: 3.6, reviews: 28, competitor: 'Carolina Yards', phone: '(919) 555-0164', status: 'New' },
]

export const samScript = [
  { label: 'Opener', text: "Hi, is this the owner? Great — my name's {yourName} with {agency}. I'll be quick: I was looking at Google Maps for {industry}s in {city} and noticed you're showing up around position {rank} when people search '{keyword}'. Is getting more calls from Google something you're working on right now?" },
  { label: 'Problem', text: "Here's what usually causes that. Google ranks profiles on activity — posts, photos, reviews, and how complete the profile is. Yours hasn't had a new photo or post in a while, and {competitor} is posting most weeks. That's most of the gap." },
  { label: 'Proof', text: "I ran a free heatmap on your profile — it shows exactly where you rank across your city on a grid. Want me to text it over? Costs you nothing either way." },
  { label: 'Close', text: "What we do is handle all of that automatically — posts, photos, review requests and replies — and you get a report every month showing the ranking movement. It's {price} a month, no contract. Want to start with the audit and go from there?" },
]

export const samObjections = [
  { objection: "I'm already working with someone.", rebuttal: "Totally fair — most owners we talk to are. Quick question: when did they last post to your Google profile? I'm asking because the heatmap I pulled shows you dropping outside the top 3 in most of your city, which usually means the profile isn't being touched. Happy to send the audit so you can hold them to it." },
  { objection: "I don't have the budget.", rebuttal: "Understood, and I'm not going to try to talk you into something you can't afford. For context, one {industry} job is worth roughly ${value} to you — this runs less than that per month. If it doesn't produce at least one extra job, it's not worth keeping and you can cancel any time." },
  { objection: 'Just send me some information.', rebuttal: "I'll do you one better — let me send the actual audit of your profile instead of a brochure. It shows your ranking grid, your top 3 competitors, and the specific things costing you position. What's the best email? I'll follow up Thursday once you've had a look." },
  { objection: 'Does this actually work?', rebuttal: "It depends on your category and competition, so I won't promise you a number. What I can show you is the before-and-after heatmaps from clients in your industry. If your profile is currently inactive, there's usually real room to move — but I'd rather you see the data than take my word for it." },
]
