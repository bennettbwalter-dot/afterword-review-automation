import { Check, CheckCircle2, Star } from "lucide-react";
import { type ReactNode } from "react";
import { IS_DEMO_MODE, type GoogleProfileSnapshot } from "../../platform/api";
import type { BusinessAccount, ReviewRecord } from "../../platform/domain";

function StatusPill({ tone = "neutral", children }: { tone?: string; children: ReactNode }) {
  return <span className={`status-pill status-pill--${tone}`}>{children}</span>;
}

function Stars({ rating, size = 15 }: { rating: number; size?: number }) {
  return <span className="stars" role="img" aria-label={`${rating} out of 5 stars`}>{Array.from({ length: 5 }, (_, index) => <Star key={index} size={size} strokeWidth={1.8} aria-hidden="true" className={index < rating ? "is-filled" : ""} />)}</span>;
}

function DemoNotice() {
  if (!IS_DEMO_MODE) return null;
  return <div className="demo-notice"><span className="demo-label">Sample data</span><p>This workspace is interactive but simulated. No Google account is connected and no message will be sent.</p></div>;
}

export function reviewsForGoogleProfileSnapshot(snapshot: GoogleProfileSnapshot): ReviewRecord[] {
  return snapshot.reviews;
}

export function ReviewsTab({ business, snapshot }: { business: BusinessAccount; snapshot: GoogleProfileSnapshot }) {
  const reviews = reviewsForGoogleProfileSnapshot(snapshot);
  const awaitingReply = reviews.filter((review) => !review.replied).length;
  return <div className="view-stack"><DemoNotice />
    <section className="reviews-summary"><div><span>Current rating</span><strong>{business.metrics.rating.toFixed(1)}</strong><Stars rating={Math.round(business.metrics.rating)} size={18} /><small>{business.metrics.totalReviews} Google reviews{IS_DEMO_MODE ? " · sample" : ""}</small></div><div><span>{IS_DEMO_MODE ? "Detected this month" : "Current cache"}</span><strong>{business.metrics.reviewsDetected}</strong><small>{IS_DEMO_MODE ? `Last sync · ${business.lastSuccess}` : `Google sync · ${business.integrations.google.lastEvent}`}</small></div><div><span>Awaiting reply</span><strong>{awaitingReply}</strong><small>Owner replies remain on Google</small></div></section>
    <section className="panel review-feed-panel"><header className="panel__head"><div><h2>Google review feed</h2><p>{business.name} · {business.locationName}{IS_DEMO_MODE ? " · sample data" : ""}</p></div><StatusPill tone={IS_DEMO_MODE ? business.healthTone : business.integrations.google.tone}>{(IS_DEMO_MODE ? business.healthTone : business.integrations.google.tone) === "success" && <CheckCircle2 size={14} />} {IS_DEMO_MODE ? business.healthTone === "success" ? "Sync healthy" : "Check integration" : business.integrations.google.status}</StatusPill></header>
      {reviews.length > 0 ? <div className="review-feed">{reviews.map((review) => <article key={review.id}><div className="review-feed__top"><span className="review-avatar">{review.name[0]}</span><span><strong>{review.name}</strong><small>{review.date}</small></span><Stars rating={review.rating} /></div><p>{review.body}</p><div><StatusPill tone={review.replied ? "neutral" : "warning"}>{review.replied ? <><Check size={13} /> Replied</> : "Reply pending"}</StatusPill><small className="review-feed__provider-status">{IS_DEMO_MODE ? "Sample review" : "Open the original review in Google Business Profile"}</small></div></article>)}</div> : <div className="empty-state"><Star size={22} /><h2>No Google reviews are cached yet.</h2><p>Reviews will appear after a successful Google Business Profile sync.</p></div>}
    </section>
  </div>;
}
