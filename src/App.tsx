import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bell,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  ClipboardCheck,
  Clock3,
  FileText,
  Gauge,
  Link2,
  ListFilter,
  Mail,
  MapPin,
  Menu,
  MessageSquareText,
  Moon,
  Plus,
  Printer,
  QrCode,
  Search,
  Send,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Star,
  Sun,
  Webhook,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  AgencyOverviewView,
  AuditLogView,
  ClientsView,
  ExceptionsView,
  TeamBillingView,
} from "./platform/AgencyViews";
import { LivePublicReviewFlow, PublicReviewFlow, QrCodesView } from "./platform/QrCodesView";
import GrowthSuite from "./growth/GrowthSuite";
import { AgencyView } from "./features/agency/AgencyView";
import { ClientLocationSelector } from "./features/agency/ClientLocationSelector";
import { ContentView } from "./features/content/ContentView";
import { GoogleProfileView } from "./features/google-profile/GoogleProfileView";
import { HomeView } from "./features/home/HomeView";
import { ReportsView as ProductReportsView } from "./features/reports/ReportsView";
import { SettingsBillingView } from "./features/settings/SettingsBillingView";
import { SignupView } from "./features/onboarding/SignupView";
import { VerifyEmailView } from "./features/onboarding/VerifyEmailView";
import { BusinessOnboarding } from "./features/onboarding/BusinessOnboarding";
import { AgencyOnboarding } from "./features/onboarding/AgencyOnboarding";
import { CheckEmailView } from "./features/onboarding/CheckEmailView";
import { LegacyRouteRedirect } from "./features/shared/LegacyRouteRedirect";
import { WorkspaceContextBar } from "./features/shared/WorkspaceContextBar";
import {
  ApiError,
  IS_DEMO_MODE,
  platformApi,
  type CompletedJobDraft,
  type GoogleProfileSelectionPayload,
  type ServiceStatus,
  type WorkspaceAccess,
  type WorkspacePayload,
} from "./platform/api";
import {
  ADMIN_SESSION,
  BUSINESSES,
  INITIAL_AUDIT_EVENTS,
  INITIAL_QR_CODES_BY_BUSINESS,
  INITIAL_REQUESTS_BY_BUSINESS,
  OWNER_SESSION,
  PLATFORM_EXCEPTIONS,
  REVIEWS_BY_BUSINESS,
  canConfigureTenant,
  canManageBilling,
  canReadTenantData,
  getBusiness,
  getQrCodeByToken,
  makeAuditEvent,
  startSupportSession,
  type ActorRole,
  type AuditEvent,
  type BusinessAccount,
  type Channel,
  type LocationWorkflowSummary,
  type RequestRecord,
  type RequestStatus,
  type ReviewRecord,
  type QrCodeRecord,
  type SessionContext,
  type SmsOveragePolicy,
  type SupportScope,
  type SupportSession,
} from "./platform/domain";
import {
  defaultAppView,
  defaultWorkspaceRoute,
  isAppViewAllowed,
  parseWorkspaceRoute,
  workspaceBusinessForSession,
  workspaceContextFromSearch,
  workspaceLocationForBusiness,
  workspaceRoute,
  workspaceRouteForSession,
  type AppView,
} from "./routing";

type WorkspaceLoadState = "loading" | "anonymous" | "authenticated" | "error";
type WorkspaceNotice = { tone: "success" | "warning" | "error"; message: string };
type PricingOfferId = "pro-monthly" | "pro-annual" | "multi-monthly";

interface PricingOffer {
  id: PricingOfferId;
  name: string;
  price: string;
  period: string;
  setup: string;
  description: string;
  smsAllowance: string;
  features: string[];
  featured?: boolean;
}

interface StoryStep {
  title: string;
  copy: string;
  detail: string;
  icon: LucideIcon;
}

const STORY_STEPS: StoryStep[] = [
  {
    title: "A completed job arrives.",
    copy: "Webhook, CSV, CRM or a quick manual entry. Every request starts with a genuine completed job and a customer record.",
    detail: "Job #HH-2841 · Boiler service",
    icon: ClipboardCheck,
  },
  {
    title: "The customer gets a human request.",
    copy: "First name, business name and the direct Google review link resolve automatically. The wording stays neutral.",
    detail: "SMS delivered · 14:06",
    icon: MessageSquareText,
  },
  {
    title: "Silence gets a polite follow-up.",
    copy: "Quiet hours, spacing and a hard three-touch limit are enforced. A reply or opt-out cancels every pending message.",
    detail: "Follow-up queued · tomorrow 10:00",
    icon: Clock3,
  },
  {
    title: "Google remains the destination.",
    copy: "The customer lands on the business’s real Google review page. There is no star pre-screen and no positive-only route.",
    detail: "New Google review detected",
    icon: Star,
  },
  {
    title: "The month closes with proof.",
    copy: "Delivery, clicks, reviews detected, rating movement, opt-outs and exceptions become one simple client report.",
    detail: "July report ready",
    icon: BarChart3,
  },
];

const PRICING_OFFERS: PricingOffer[] = [
  {
    id: "pro-monthly",
    name: "Reputation Pro monthly",
    price: "£39",
    period: "/month",
    setup: "£149 setup fee",
    description: "One location with paid onboarding and monthly billing.",
    smsAllowance: "100 SMS segments per month",
    features: ["Unlimited email requests", "One automated reminder", "Review link, QR code and monthly report", "Extra 100 SMS segments for £10"],
  },
  {
    id: "pro-annual",
    name: "Reputation Pro annual",
    price: "£390",
    period: "/year",
    setup: "£149 setup fee",
    description: "The same one-location plan with one annual subscription payment.",
    smsAllowance: "100 SMS segments per month",
    features: ["Unlimited email requests", "One automated reminder", "Review link, QR code and monthly report", "Extra 100 SMS segments for £10"],
    featured: true,
  },
  {
    id: "multi-monthly",
    name: "Reputation Multi",
    price: "£79",
    period: "/month",
    setup: "Setup quoted by location count",
    description: "Up to five locations with central reporting and shared billing.",
    smsAllowance: "300 pooled SMS segments per month",
    features: ["£249 setup for 2–3 locations", "£349 setup for 4–5 locations", "Location-level and combined reporting", "Extra 100 pooled SMS segments for £10"],
  },
];

const CLIENT_NAV: Array<{ id: AppView; label: string; icon: LucideIcon }> = [
  { id: "home", label: "Home", icon: Sparkles },
  { id: "google-profile", label: "Google Profile", icon: Star },
  { id: "content", label: "Content", icon: Activity },
  { id: "reports", label: "Reports", icon: FileText },
  { id: "settings-billing", label: "Settings & billing", icon: Building2 },
];

const AGENCY_NAV: Array<{ id: AppView; label: string; icon: LucideIcon }> = [
  { id: "agency", label: "Agency", icon: Gauge },
];

const STATUS_TONES: Record<RequestStatus, string> = {
  Queued: "warning",
  Delivered: "neutral",
  Clicked: "accent",
  Reviewed: "success",
  "Opted out": "muted",
  Blocked: "warning",
};

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

type ResolvedTheme = "light" | "dark";
const THEME_STORAGE_KEY = "review-anchor-theme";

const ThemeContext = createContext<{ resolved: ResolvedTheme; toggle: () => void }>({
  resolved: "light",
  toggle: () => undefined,
});

function readStoredTheme(): ResolvedTheme | "system" {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

function systemPrefersDark() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ResolvedTheme | "system">(readStoredTheme);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") {
      delete root.dataset.theme;
    } else {
      root.dataset.theme = theme;
    }
    try {
      if (theme === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
      else window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      /* storage unavailable — theme still applies for this visit */
    }
  }, [theme]);

  const resolved: ResolvedTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme;
  const value = useMemo(() => ({
    resolved,
    toggle: () => setTheme(resolved === "dark" ? "light" : "dark"),
  }), [resolved]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

function ThemeToggle({ className }: { className?: string }) {
  const { resolved, toggle } = useContext(ThemeContext);
  return (
    <IconButton
      label={resolved === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      className={className}
      onClick={toggle}
    >
      {resolved === "dark" ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
    </IconButton>
  );
}

function LogoMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 36 36" role="img" aria-label="Review Anchor mark">
      <rect x="1" y="1" width="34" height="34" rx="10.5" stroke="none" />
      <g fill="none">
        <circle cx="18" cy="9.4" r="2.6" />
        <path d="M18 12v15.4" />
        <path d="M12.7 16.2h10.6" />
        <path d="M8.9 20.9c1 5.3 5 7.4 9.1 7.4s8.1-2.1 9.1-7.4" />
        <path d="M8.9 20.9 6.7 19.4" />
        <path d="M27.1 20.9l2.2-1.5" />
      </g>
    </svg>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className={cx("brand", compact && "brand--compact")}>
      <LogoMark />
      <span className="brand__name">Review Anchor</span>
    </span>
  );
}

function IconButton({ label, children, onClick, className, disabled, expanded, controls }: { label: string; children: ReactNode; onClick?: () => void; className?: string; disabled?: boolean; expanded?: boolean; controls?: string }) {
  return (
    <button className={cx("icon-button", className)} type="button" aria-label={label} aria-expanded={expanded} aria-controls={controls} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

function StatusPill({ tone = "neutral", children }: { tone?: string; children: ReactNode }) {
  return <span className={cx("status-pill", `status-pill--${tone}`)}>{children}</span>;
}

function Stars({ rating, size = 15 }: { rating: number; size?: number }) {
  return (
    <span className="stars" role="img" aria-label={`${rating} out of 5 stars`}>
      {Array.from({ length: 5 }, (_, index) => (
        <Star key={index} size={size} strokeWidth={1.8} aria-hidden="true" className={index < rating ? "is-filled" : ""} />
      ))}
    </span>
  );
}

function Button({
  children,
  variant = "primary",
  onClick,
  type = "button",
  state,
  disabled,
  className,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "quiet" | "danger";
  onClick?: () => void;
  type?: "button" | "submit";
  state?: "loading" | "success" | "error";
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type={type}
      className={cx("button", `button--${variant}`, className)}
      onClick={onClick}
      data-state={state}
      disabled={disabled || state === "loading"}
      aria-busy={state === "loading"}
    >
      {children}
    </button>
  );
}

function Modal({ open, onClose, label, children, className }: { open: boolean; onClose: () => void; label: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={cx("dialog", className)}
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {children}
    </dialog>
  );
}

function useFloatingNav() {
  const [floating, setFloating] = useState(false);

  useEffect(() => {
    let ticking = false;
    let current = false;
    const update = () => {
      const next = window.scrollY > 80;
      if (next !== current) {
        current = next;
        setFloating(next);
      }
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        update();
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return floating;
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}

function MarketingNav({ onOpenDemo }: { onOpenDemo: () => void }) {
  const floating = useFloatingNav();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className={cx("marketing-nav", floating && "is-floating", menuOpen && "is-menu-open")}>
      <div className="marketing-nav__inner">
        <a href="#top" className="marketing-nav__brand" aria-label="Review Anchor home" onClick={() => setMenuOpen(false)}>
          <Brand />
        </a>
        <nav className="marketing-nav__links" aria-label="Main navigation">
          <a href="#workflow" onClick={() => setMenuOpen(false)}>How it works</a>
          <a href="#pricing" onClick={() => setMenuOpen(false)}>Pricing</a>
          <button type="button" className="nav-demo-link" onClick={onOpenDemo}>Growth Suite</button>
        </nav>
        <ThemeToggle className="marketing-nav__theme" />
        <Button variant="primary" className="marketing-nav__cta" onClick={onOpenDemo}>
          {IS_DEMO_MODE ? "Open product" : "Sign in"}
        </Button>
        <IconButton label={menuOpen ? "Close navigation" : "Open navigation"} className="marketing-nav__menu" onClick={() => setMenuOpen((value) => !value)}>
          {menuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
        </IconButton>
      </div>
    </header>
  );
}

function HeroJourney() {
  return (
    <figure className="hero-journey" aria-label="Demo of a live review request journey">
      <figcaption className="hero-journey__head">
        <span>
          <span className="hero-journey__business">Harbour &amp; Hearth</span>
          <span className="hero-journey__location">Bristol · Demo workspace</span>
        </span>
        <StatusPill tone="success"><span className="live-dot" /> Automation live</StatusPill>
      </figcaption>
      <div className="hero-journey__body">
        <div className="mini-job-card">
          <span className="mini-job-card__icon"><ClipboardCheck size={18} aria-hidden="true" /></span>
          <span><strong>Job completed</strong><small>Boiler service · Amelia</small></span>
          <CheckCircle2 size={18} aria-hidden="true" />
        </div>
        <div className="mini-path" aria-hidden="true"><span /><span /><span /></div>
        <div className="mini-message">
          <span className="mini-message__meta"><Smartphone size={15} aria-hidden="true" /> SMS · Delivered</span>
          <p>Hi Amelia, thanks for choosing Harbour &amp; Hearth. Would you mind leaving an honest Google review?</p>
          <span className="mini-message__link">g.page/r/harbour-hearth/review</span>
        </div>
        <div className="mini-review">
          <div><Stars rating={5} /><span className="mini-review__time">12 min ago</span></div>
          <blockquote>“Tidy work and everything was explained properly.”</blockquote>
          <span>Amelia C. · Google review</span>
        </div>
      </div>
    </figure>
  );
}

function JourneyCanvas({ activeStep }: { activeStep: number }) {
  const active = STORY_STEPS[activeStep];
  const ActiveIcon = active.icon;
  return (
    <figure className="journey-canvas" aria-label={`Workflow preview: ${active.title}`}>
      <figcaption className="journey-canvas__head">
        <span>
          <small>Send review request</small>
          <strong>Harbour &amp; Hearth · Bristol</strong>
        </span>
        <StatusPill tone="success"><span className="live-dot" /> Live</StatusPill>
      </figcaption>
      <div className="journey-canvas__content">
        <div className="journey-track" aria-hidden="true">
          {STORY_STEPS.map((step, index) => {
            const Icon = step.icon;
            const state = index < activeStep ? "complete" : index === activeStep ? "active" : "pending";
            return (
              <div className={cx("journey-node", `is-${state}`)} key={step.title}>
                <span className="journey-node__icon">{state === "complete" ? <Check size={16} /> : <Icon size={16} />}</span>
                <span>{index === 0 ? "Job" : index === 1 ? "Request" : index === 2 ? "Follow-up" : index === 3 ? "Review" : "Report"}</span>
              </div>
            );
          })}
          <span className="journey-track__line" />
          <span className="journey-track__progress" style={{ "--step": activeStep } as CSSProperties} />
        </div>
        <div className="journey-focus" key={active.title}>
          <span className="journey-focus__icon"><ActiveIcon size={24} aria-hidden="true" /></span>
          <span className="journey-focus__label">{active.detail}</span>
          <h3>{active.title}</h3>
          {activeStep === 0 && (
            <dl className="journey-data">
              <div><dt>Customer</dt><dd>Amelia Carter</dd></div>
              <div><dt>Job</dt><dd>Boiler service</dd></div>
              <div><dt>Eligibility</dt><dd><CheckCircle2 size={15} /> Genuine customer</dd></div>
            </dl>
          )}
          {activeStep === 1 && (
            <div className="journey-phone">
              <span className="journey-phone__speaker" aria-hidden="true" />
              <div className="journey-phone__screen">
                <span className="journey-phone__meta"><Smartphone size={12} aria-hidden="true" /> SMS · today 14:06</span>
                <p className="journey-phone__bubble">
                  Hi Amelia, thanks for choosing Harbour &amp; Hearth. If you have 30 seconds, we’d appreciate an honest
                  Google review: <span className="journey-phone__link">g.page/r/harbour-hearth</span> Reply STOP to opt out.
                </p>
                <span className="journey-phone__receipt"><CheckCircle2 size={12} aria-hidden="true" /> Delivered</span>
              </div>
            </div>
          )}
          {activeStep === 2 && (
            <div className="journey-delay">
              <Clock3 size={18} aria-hidden="true" />
              <span><strong>Wait 48 hours</strong><small>Cancel if replied, reviewed or opted out</small></span>
            </div>
          )}
          {activeStep === 3 && (
            <div className="journey-review-card">
              <Stars rating={5} size={17} />
              <p>“Clear arrival time, tidy work and the boiler was explained properly.”</p>
              <span>Amelia C. · Detected on Google</span>
            </div>
          )}
          {activeStep === 4 && (
            <div className="journey-report-mini">
              <div><span>Requests delivered</span><strong>121</strong></div>
              <div><span>Reviews detected</span><strong>11</strong></div>
              <div><span>Current rating</span><strong>4.8</strong></div>
              <small>Sample data · exact request-to-review attribution is estimated.</small>
            </div>
          )}
        </div>
      </div>
    </figure>
  );
}

function OutcomePreview() {
  const chartPoints = "10,78 42,66 74,70 106,49 138,55 170,38 202,43 234,26 266,31 298,18";
  return (
    <figure className="outcome-preview" aria-label="Demo reputation overview dashboard">
      <figcaption className="outcome-preview__head">
        <span><small>Overview</small><strong>July performance</strong></span>
        <span className="demo-label">Sample data</span>
      </figcaption>
      <div className="outcome-metrics">
        <article><span>Reviews detected</span><strong>11</strong><small>Google sync · this month</small></article>
        <article><span>Current rating</span><strong>4.8</strong><small>126 total reviews</small></article>
        <article><span>Delivery rate</span><strong>94%</strong><small>Messages accepted</small></article>
      </div>
      <div className="outcome-chart">
        <div><span>Rating trend</span><small>Jan–Jul · sample</small></div>
        <svg viewBox="0 0 308 90" role="img" aria-label="Sample rating trend rising over seven months">
          <polyline points={chartPoints} />
          {chartPoints.split(" ").map((point) => {
            const [cxValue, cyValue] = point.split(",");
            return <circle key={point} cx={cxValue} cy={cyValue} r="3" />;
          })}
        </svg>
      </div>
      <div className="outcome-alert"><CheckCircle2 size={18} /><span><strong>All systems healthy</strong><small>Last completed-job trigger · 4 min ago</small></span></div>
    </figure>
  );
}

function PlanSelectionDialog({ offer, onClose, onOpenDemo }: { offer: PricingOffer; onClose: () => void; onOpenDemo: () => void }) {
  return (
    <Modal open onClose={onClose} label={`${offer.name} selection`}>
      <div className="dialog-card plan-selection-dialog">
        <header className="dialog-card__head"><div><span className="dialog-icon"><ClipboardCheck size={20} /></span><div><small>Selected offer</small><h2>{offer.name}</h2></div></div><IconButton label="Close plan selection" onClick={onClose}><X size={19} /></IconButton></header>
        <div className="plan-selection-summary">
          <span><small>Subscription</small><strong>{offer.price}{offer.period}</strong></span>
          <span><small>Implementation</small><strong>{offer.setup}</strong></span>
          <span><small>Included SMS</small><strong>{offer.smsAllowance}</strong></span>
        </div>
        <div className="implementation-guarantee"><ShieldCheck size={22} /><div><h3>Implementation guarantee</h3><p>Pay the setup fee and complete onboarding. If we cannot configure and deliver the review-request system agreed during setup, we will refund the setup fee.</p></div></div>
        <div className="dialog-note"><AlertTriangle size={16} /><span>Secure Stripe Checkout is available only after signing in to an authorised business workspace. The setup fee is charged before implementation starts.</span></div>
        <footer className="dialog-card__actions"><Button variant="quiet" onClick={onClose}>Close</Button><Button onClick={() => { onClose(); onOpenDemo(); }}>Preview the workspace</Button></footer>
      </div>
    </Modal>
  );
}

function MarketingSite({ onOpenDemo, onStartSetup }: { onOpenDemo: () => void; onStartSetup: () => void }) {
  const [activeStoryStep, setActiveStoryStep] = useState(0);
  const [selectedOfferId, setSelectedOfferId] = useState<PricingOfferId | null>(null);
  const stepRefs = useRef<Array<HTMLElement | null>>([]);
  const selectedOffer = PRICING_OFFERS.find((offer) => offer.id === selectedOfferId);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActiveStoryStep(Number((visible.target as HTMLElement).dataset.step));
      },
      { rootMargin: "-32% 0px -42%", threshold: [0.1, 0.35, 0.65] },
    );
    stepRefs.current.forEach((node) => node && observer.observe(node));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="marketing-site" id="top">
      <MarketingNav onOpenDemo={onOpenDemo} />
      <main>
        <section className="hero-section" aria-labelledby="hero-title">
          <div className="hero-copy reveal-sequence">
            <p className="hero-kicker"><span className="live-dot" /> Business growth, starting with reviews</p>
            <h1 id="hero-title">Get more reviews. Win more customers.</h1>
            <p className="hero-lede">Review Anchor gives local businesses one place to build customer trust, starting with genuine Google reviews. Ask every customer, follow up politely and track what changes.</p>
            <div className="hero-actions">
              <Button onClick={onStartSetup}>Open Growth Suite <ArrowRight size={17} aria-hidden="true" /></Button>
              <Button variant="secondary" onClick={() => document.getElementById("workflow")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })}>
                Watch the workflow
              </Button>
            </div>
            <div className="hero-trust-row">
              <span><ShieldCheck size={16} /> No review gating</span>
              <span><Clock3 size={16} /> Three-touch maximum</span>
              <span><Bell size={16} /> Exception alerts</span>
            </div>
          </div>
          <div className="hero-proof reveal-sequence"><HeroJourney /></div>
        </section>

        <section className="truth-strip" aria-label="Product rules">
          <div><strong>1</strong><span>location per Reputation Pro account</span></div>
          <div><strong>3</strong><span>messages maximum per completed job</span></div>
          <div><strong>0</strong><span>sentiment gates or positive-only routes</span></div>
          <p>Email requests do not use the SMS allowance.</p>
        </section>

        <section className="workflow-section" id="workflow" aria-labelledby="workflow-title">
          <header className="section-heading">
            <h2 id="workflow-title">One honest line from finished work to Google.</h2>
            <p>Merge fields, polite timing and follow-ups without a sprawling workflow builder. Scroll the journey — every completed job follows the same neutral route from the moment it arrives to the monthly report.</p>
          </header>
          <div className="workflow-story">
            <div className="workflow-story__steps">
              {STORY_STEPS.map((step, index) => {
                const Icon = step.icon;
                return (
                  <article
                    className={cx("story-step", index === activeStoryStep && "is-active")}
                    data-step={index}
                    key={step.title}
                    ref={(node) => { stepRefs.current[index] = node; }}
                  >
                    <span className="story-step__marker"><Icon size={19} aria-hidden="true" /></span>
                    <div><h3>{step.title}</h3><p>{step.copy}</p><small>{step.detail}</small></div>
                  </article>
                );
              })}
            </div>
            <div className="workflow-story__canvas"><JourneyCanvas activeStep={activeStoryStep} /></div>
          </div>
        </section>

        <section className="control-section" id="monitoring" aria-labelledby="control-title">
          <div className="control-copy">
            <span className="plain-label">Review Anchor dashboard</span>
            <h2 id="control-title">Monitor reputation outcomes and exceptions.</h2>
            <p>This is the reporting and oversight layer after the request workflow: delivery failures, opt-outs, new reviews and broken integrations come to the top.</p>
            <ul className="check-list">
              <li><Check size={17} /> Completed-job trigger health</li>
              <li><Check size={17} /> Delivery, click and opt-out events</li>
              <li><Check size={17} /> New Google reviews and rating movement</li>
              <li><Check size={17} /> Monthly client report, ready to print</li>
            </ul>
          <Button variant="secondary" onClick={onOpenDemo}>Open Growth Suite <ArrowRight size={17} /></Button>
          </div>
          <OutcomePreview />
        </section>

        <section className="guardrail-section" aria-labelledby="guardrail-title">
          <header>
            <ShieldCheck size={28} aria-hidden="true" />
            <h2 id="guardrail-title">Honest by design.</h2>
            <p>Google is the destination. Every eligible customer gets the same neutral route.</p>
          </header>
          <div className="guardrail-ledger">
            <article><strong>No sentiment branch</strong><span>No “happy customer?” screen and no star pre-filter.</span></article>
            <article><strong>No incentives</strong><span>Templates do not offer discounts, prizes or rewards for a review.</span></article>
            <article><strong>Immediate suppression</strong><span>STOP cancels pending messages and blocks future enrolment.</span></article>
            <article><strong>Clear attribution</strong><span>Reviews detected and estimated conversion remain separate metrics.</span></article>
            <article><strong>No outcome promises</strong><span>We do not guarantee review counts, ratings, search rankings, enquiries or revenue.</span></article>
          </div>
        </section>

        <section className="pricing-section" id="pricing" aria-labelledby="pricing-title">
          <header className="section-heading section-heading--compact">
            <h2 id="pricing-title">Choose your billing schedule.</h2>
            <p>Every plan starts with paid implementation. SMS allowances are measured in billable segments, and email requests are unlimited.</p>
          </header>
          <div className="pricing-ledger">
            {PRICING_OFFERS.map((offer) => <article className={cx("pricing-row", offer.featured && "pricing-row--featured")} key={offer.id}>
              <div><span>{offer.name}{offer.featured && <em>Best annual value</em>}</span><strong>{offer.price}<small>{offer.period}</small></strong></div>
              <p>{offer.description} <strong>{offer.setup}.</strong></p>
              <ul><li>{offer.smsAllowance}</li>{offer.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
              <Button variant={offer.featured ? "primary" : "secondary"} onClick={() => setSelectedOfferId(offer.id)}>Choose {offer.id === "multi-monthly" ? "Multi" : offer.id === "pro-annual" ? "annual" : "monthly"}</Button>
            </article>)}
          </div>
          <div className="implementation-guarantee implementation-guarantee--section"><ShieldCheck size={24} /><div><h3>Implementation guarantee</h3><p>Pay the setup fee and complete onboarding. If we cannot configure and deliver the review-request system agreed during setup, we will refund the setup fee.</p><small>The guarantee covers agreed configuration and delivery. It does not promise review volume, ratings, rankings, enquiries or revenue.</small></div></div>
        </section>

        <section className="faq-section" aria-labelledby="faq-title">
          <h2 id="faq-title">The practical questions.</h2>
          <div className="faq-list">
            <details><summary>Does Review Anchor move or copy our Google profile?<ChevronDown size={18} /></summary><p>No. Your Business Profile stays on Google. Review Anchor connects with owner permission, links genuine customers to Google and monitors review data that Google makes available.</p></details>
            <details><summary>Can we send only to customers who say they are happy?<ChevronDown size={18} /></summary><p>No. That is review gating. Eligible genuine customers receive the same neutral route regardless of expected sentiment.</p></details>
            <details><summary>How many follow-ups can go out?<ChevronDown size={18} /></summary><p>The hard product limit is three total messages per completed job. Most sequences should use fewer.</p></details>
            <details><summary>Is there a free trial?<ChevronDown size={18} /></summary><p>No. The setup fee covers real implementation work and is charged before onboarding. The implementation guarantee refunds that fee if we cannot deliver the agreed review-request setup.</p></details>
            <details><summary>How is SMS usage charged?<ChevronDown size={18} /></summary><p>Reputation Pro includes 100 SMS segments each month. Reputation Multi includes 300 pooled segments. Each additional 100-segment bundle costs £10, and you can choose automatic bundles or an SMS pause at the limit. Email requests continue during an SMS pause.</p></details>
          <details><summary>Is the Google connection live?<ChevronDown size={18} /></summary><p>{IS_DEMO_MODE ? "No. The demo is intentionally simulated. A production connection needs approved OAuth credentials, secure token storage and Business Profile API access." : "The authenticated workspace starts Google OAuth with explicit owner permission. Availability still depends on approved Google Business Profile API access."}</p></details>
          </div>
        </section>
      </main>

      <footer className="statement-footer">
        <p>Get more reviews. Win more customers.</p>
        <div><Brand compact /><span>Business growth, starting with reviews · Demo build</span><span>© 2026</span></div>
      </footer>

      {activeStoryStep >= 2 && (
        <aside className="sticky-cta is-visible">
          <span><strong>Ready to see it working?</strong><small>{IS_DEMO_MODE ? "Open the seeded demo—no account needed." : "Sign in to your protected business workspace."}</small></span>
          <Button onClick={onOpenDemo}>{IS_DEMO_MODE ? "Open demo" : "Sign in"} <ArrowRight size={16} /></Button>
        </aside>
      )}
      {selectedOffer && <PlanSelectionDialog offer={selectedOffer} onClose={() => setSelectedOfferId(null)} onOpenDemo={onOpenDemo} />}
    </div>
  );
}

function AppSidebar({
  view,
  onView,
  onBack,
  open,
  onClose,
  navItems,
  business,
  session,
  supportSession,
  onRoleChange,
  businessCount,
  exceptionCount,
  demoMode,
  onLogout,
  compactViewport,
}: {
  view: AppView;
  onView: (view: AppView) => void;
  onBack: () => void;
  open: boolean;
  onClose: () => void;
  navItems: Array<{ id: AppView; label: string; icon: LucideIcon }>;
  business: BusinessAccount;
  session: SessionContext;
  supportSession: SupportSession | null;
  onRoleChange: (role: ActorRole) => void;
  businessCount: number;
  exceptionCount: number;
  demoMode: boolean;
  onLogout: () => void;
  compactViewport: boolean;
}) {
  const sidebarRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const agencyMode = session.role === "agency_admin" && !supportSession;
  const healthNeedsAttention = agencyMode || business.healthTone !== "success";
  const workspaceName = agencyMode ? "Review Anchor Agency" : business.name;
  const workspaceDetail = agencyMode
    ? `${businessCount} client accounts${demoMode ? " · Demo" : ""}`
    : supportSession
      ? `Audited ${supportSession.scope === "configuration" ? "configuration" : "view-only"} support`
      : `${business.locationName}${demoMode ? " · Demo" : ""}`;

  useEffect(() => {
    if (!compactViewport || !open) return;
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sidebar.querySelector<HTMLElement>(".app-sidebar__close")?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(sidebar.querySelectorAll<HTMLElement>("button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])"))
        .filter((element) => !element.hasAttribute("inert") && element.getClientRects().length > 0);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !sidebar.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !sidebar.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [compactViewport, open]);

  return (
    <aside
      ref={sidebarRef}
      id="workspace-navigation"
      className={cx("app-sidebar", open && "is-open")}
      role={compactViewport && open ? "dialog" : undefined}
      aria-modal={compactViewport && open ? true : undefined}
      aria-label={compactViewport && open ? "Workspace navigation" : undefined}
      aria-hidden={compactViewport && !open ? true : undefined}
      inert={compactViewport && !open ? true : undefined}
    >
      <div className="app-sidebar__brand">
        <button type="button" onClick={onBack} aria-label="Return to the Review Anchor website"><Brand /></button>
        <IconButton label="Close workspace navigation" className="app-sidebar__close" onClick={onClose}><X size={19} /></IconButton>
      </div>
      <div className="workspace-switcher" aria-label={`Current workspace: ${workspaceName}`}>
        <span className="workspace-switcher__avatar">{agencyMode ? "A" : business.initials}</span>
        <span><strong>{workspaceName}</strong><small>{workspaceDetail}</small></span>
        {supportSession && <ShieldCheck size={16} aria-hidden="true" />}
      </div>
      <nav className="app-sidebar__nav" aria-label="Workspace">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              type="button"
              key={item.id}
              className={cx(view === item.id && "is-active")}
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => { onView(item.id); onClose(); }}
            >
              <Icon size={18} aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
      <div className={cx("app-sidebar__health", healthNeedsAttention && "app-sidebar__health--warning", !agencyMode && business.healthTone === "danger" && "app-sidebar__health--danger")}>
        <span>{healthNeedsAttention ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}<strong>{agencyMode ? `${exceptionCount} open exceptions` : business.health}</strong></span>
        <small>{agencyMode ? "Across the managed portfolio" : business.lastSuccess}</small>
      </div>
      {demoMode && <label className="role-preview">
        <span>Demo role preview</span>
        <select value={session.role} onChange={(event) => onRoleChange(event.target.value as ActorRole)}>
          <option value="business_owner">Business owner</option>
          <option value="agency_admin">Agency admin</option>
        </select>
        <small>Switches the seeded interface only.</small>
      </label>}
      <div className="app-sidebar__meta">
        <ThemeToggle className="app-sidebar__theme" />
        <span>{supportSession ? "Support access recorded" : demoMode ? "Demo workspace" : "Authenticated workspace"}</span>
        <button type="button" onClick={demoMode ? onBack : onLogout}>{demoMode ? "View website" : "Sign out"}</button>
      </div>
    </aside>
  );
}

function PageHeader({ title, description, onMenu, navigationOpen, actions, banner }: { title: string; description: string; onMenu: () => void; navigationOpen: boolean; actions?: ReactNode; banner?: ReactNode }) {
  return (
    <header className={cx("page-header", Boolean(banner) && "page-header--with-banner")}>
      {banner}
      <IconButton label="Open workspace navigation" className="page-header__menu" onClick={onMenu} expanded={navigationOpen} controls="workspace-navigation"><Menu size={20} /></IconButton>
      <div className="page-header__title"><h1>{title}</h1><p>{description}</p></div>
      <div className="page-header__actions">{actions}</div>
    </header>
  );
}

function DemoNotice() {
  if (!IS_DEMO_MODE) return null;
  return (
    <div className="demo-notice">
      <span className="demo-label">Sample data</span>
      <p>This workspace is interactive but simulated. No Google account is connected and no message will be sent.</p>
    </div>
  );
}

function WorkspaceAuthScreen({
  state,
  error,
  onLogin,
  onBack,
}: {
  state: "loading" | "anonymous" | "error";
  error: string;
  onLogin: (email: string, password: string) => Promise<void>;
  onBack: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loginError, setLoginError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) return;
    setSubmitting(true);
    setLoginError("");
    try {
      await onLogin(email.trim(), password);
    } catch (caught) {
      setLoginError(caught instanceof Error ? caught.message : "Sign in failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="workspace-auth-shell">
      <button className="workspace-auth-shell__brand" type="button" onClick={onBack} aria-label="Return to the Review Anchor website"><Brand /></button>
      <section className="workspace-auth-card" aria-busy={state === "loading"}>
        <span className="eyebrow">Secure workspace</span>
        <h1>{state === "loading" ? "Opening your workspace…" : "Sign in to Review Anchor"}</h1>
        <p>{state === "loading" ? "Checking your encrypted session and tenant access." : "Use the account assigned to your business or agency."}</p>
        {state === "loading" ? (
          <div className="workspace-auth-loading" role="status"><span aria-hidden="true" /> Authenticating…</div>
        ) : (
          <form onSubmit={submit} noValidate>
            <div className="field-group field-group--full"><label htmlFor="workspace-email">Email address</label><input id="workspace-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
            <div className="field-group field-group--full"><label htmlFor="workspace-password">Password</label><input id="workspace-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></div>
            {(loginError || error) && <div className="workspace-auth-error" role="alert"><AlertTriangle size={16} /> {loginError || error}</div>}
            <Button type="submit" state={submitting ? "loading" : undefined} disabled={submitting || !email.trim() || !password}>{submitting ? "Signing in…" : "Sign in securely"}</Button>
          </form>
        )}
        <small>Sessions use secure, HTTP-only cookies. Tenant permissions are checked again by the API and PostgreSQL on every request.</small>
      </section>
    </main>
  );
}

function RequestsView({ requests, onAddJob, canConfigure }: { requests: RequestRecord[]; onAddJob: () => void; canConfigure: boolean }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"All" | RequestStatus>("All");
  const filtered = useMemo(
    () => requests.filter((request) => (status === "All" || request.status === status) && `${request.customer} ${request.job}`.toLowerCase().includes(query.toLowerCase())),
    [query, requests, status],
  );

  return (
    <div className="view-stack">
      <DemoNotice />
      <section className="panel request-table-panel">
        <header className="table-toolbar">
          <div className="search-field"><Search size={17} aria-hidden="true" /><label className="sr-only" htmlFor="request-search">Search requests</label><input id="request-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search customer or job" /></div>
          <label className="select-field"><ListFilter size={16} aria-hidden="true" /><span className="sr-only">Filter by status</span><select value={status} onChange={(event) => setStatus(event.target.value as "All" | RequestStatus)}><option>All</option><option>Queued</option><option>Delivered</option><option>Clicked</option><option>Reviewed</option><option>Opted out</option><option>Blocked</option></select><ChevronDown size={15} aria-hidden="true" /></label>
          {canConfigure && <Button onClick={onAddJob}><Plus size={16} /> Add completed job</Button>}
        </header>
        {requests.length === 0 ? (
          <div className="empty-state"><ClipboardCheck size={24} /><h2>No completed jobs yet.</h2><p>{canConfigure ? "Add a genuine completed job with consent evidence to start its review-request workflow." : "Your role can view request history but cannot add completed jobs."}</p>{canConfigure && <Button onClick={onAddJob}><Plus size={16} /> Add completed job</Button>}</div>
        ) : filtered.length > 0 ? (
          <>
            <div className="request-table" role="table" aria-label="Review requests">
              <div className="request-table__head" role="row"><span role="columnheader">Customer</span><span role="columnheader">Job</span><span role="columnheader">Channel</span><span role="columnheader">Created</span><span role="columnheader">Status</span></div>
              {filtered.map((request) => (
                <div className="request-table__row" role="row" key={request.id}>
                  <span role="cell"><strong>{request.customer}</strong><small>{request.id} · {request.destination} · consent {request.consentStatus.toLowerCase()}</small></span>
                  <span role="cell">{request.job}</span>
                  <span role="cell">{request.channel === "SMS" ? <Smartphone size={15} /> : <Mail size={15} />}{request.channel}</span>
                  <span role="cell">{request.createdAt}</span>
                  <span role="cell"><StatusPill tone={STATUS_TONES[request.status]}>{request.status}</StatusPill></span>
                </div>
              ))}
            </div>
            <div className="request-cards">
              {filtered.map((request) => (
                <article key={request.id}>
                  <div><strong>{request.customer}</strong><StatusPill tone={STATUS_TONES[request.status]}>{request.status}</StatusPill></div>
                  <p>{request.job}</p><small>{request.channel} · {request.destination} · consent {request.consentStatus.toLowerCase()} · {request.createdAt}</small>
                </article>
              ))}
            </div>
          </>
        ) : (
          <div className="empty-state"><Search size={24} /><h2>No matching requests.</h2><p>Change the search or status filter to see more completed jobs.</p><Button variant="secondary" onClick={() => { setQuery(""); setStatus("All"); }}>Clear filters</Button></div>
        )}
      </section>
    </div>
  );
}

function workflowGapLabel(seconds: number) {
  if (seconds <= 0) return "No extra delay";
  if (seconds % 86_400 === 0) return `${seconds / 86_400} ${seconds === 86_400 ? "day" : "days"}`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600} ${seconds === 3_600 ? "hour" : "hours"}`;
  return `${Math.ceil(seconds / 60)} minutes`;
}

const BLOCKED_GOOGLE_CONNECTION_HEALTH = new Set(["authentication_required", "permission_revoked", "disabled"]);

function seededDemoWorkflow(business: BusinessAccount, qrCode?: QrCodeRecord): LocationWorkflowSummary | undefined {
  if (!business.locationId) return undefined;
  const destination = qrCode?.locationId === business.locationId && qrCode.destinationVerified
    ? qrCode.destinationUrl
    : undefined;
  return {
    businessId: business.id,
    locationId: business.locationId,
    channels: [{
      channel: "sms",
      enabled: true,
      timezone: business.timezone,
      allowedWeekdays: [1, 2, 3, 4, 5, 6],
      sendWindowStart: "09:00",
      sendWindowEnd: "18:00",
      maxMessages: 2,
      minimumGapSeconds: 172_800,
      ruleVersion: "seeded-demo-v1",
      template: {
        id: `demo-template-${business.locationId}`,
        key: "review-request",
        version: 1,
        body: "Hi {{first_name}}, thanks for choosing {{business_name}}. If you have 30 seconds, we’d appreciate an honest Google review: {{review_link}}. Reply STOP to opt out.",
        includesBusinessIdentity: true,
        includesUnsubscribe: true,
        approvedAt: "Seeded demo configuration",
      },
    }],
    reviewDestination: destination ? {
      runtimeUrl: destination,
      qrUrl: destination,
      verifiedAt: qrCode?.generatedAt,
      connectionHealth: "seeded_demo",
      matchesRuntime: true,
    } : null,
  };
}

function AutomationView({
  business,
  requests,
  workflow,
  onOpenIntegrations,
}: {
  business: BusinessAccount;
  requests: RequestRecord[];
  workflow?: LocationWorkflowSummary;
  onOpenIntegrations: () => void;
}) {
  const channels = useMemo(() => workflow?.channels ?? [], [workflow?.channels]);
  const defaultChannel = channels.find((candidate) => candidate.enabled)?.channel ?? channels[0]?.channel ?? "sms";
  const [selectedChannel, setSelectedChannel] = useState<"sms" | "email">(defaultChannel);
  useEffect(() => {
    if (!channels.some((candidate) => candidate.channel === selectedChannel)) setSelectedChannel(defaultChannel);
  }, [channels, defaultChannel, selectedChannel]);
  const channel = channels.find((candidate) => candidate.channel === selectedChannel)
    ?? channels.find((candidate) => candidate.enabled)
    ?? channels[0];
  const touchCount = Math.min(Math.max(channel?.maxMessages ?? 1, 1), 3);
  const gap = workflowGapLabel(channel?.minimumGapSeconds ?? 0);
  const nodes = useMemo(() => {
    const result: Array<{ id: string; label: string; description: string; icon: LucideIcon; message: boolean }> = [
      { id: "trigger", label: "Job completed", description: "Authenticated completed-job record", icon: Webhook, message: false },
      { id: "request", label: "Send review request", description: `${channel?.channel.toUpperCase() ?? "Message"} · approved template`, icon: MessageSquareText, message: true },
    ];
    for (let touch = 2; touch <= touchCount; touch += 1) {
      result.push({ id: `wait-${touch}`, label: `Wait ${gap}`, description: "Cancel on reply, review or opt-out", icon: Clock3, message: false });
      result.push({ id: `followup-${touch}`, label: `Polite follow-up ${touch - 1}`, description: `${channel?.channel.toUpperCase() ?? "Message"} · touch ${touch} of ${touchCount}`, icon: Send, message: true });
    }
    result.push({ id: "end", label: "End sequence", description: `Maximum ${touchCount} ${touchCount === 1 ? "message" : "messages"}`, icon: CheckCircle2, message: false });
    return result;
  }, [channel?.channel, gap, touchCount]);
  const [selected, setSelected] = useState("request");
  const selectedNode = nodes.find((node) => node.id === selected) ?? nodes[1] ?? nodes[0];
  const SelectedIcon = selectedNode.icon;
  const previewName = requests[0]?.customer.split(" ")[0] ?? "Customer";
  const template = channel?.template;
  const runtimeUrl = workflow?.reviewDestination?.runtimeUrl;
  const connectionHealth = workflow?.reviewDestination?.connectionHealth;
  const destinationReady = Boolean(
    runtimeUrl
    && connectionHealth
    && !BLOCKED_GOOGLE_CONNECTION_HEALTH.has(connectionHealth),
  );
  const configured = Boolean(
    channel?.enabled
    && template
    && template.includesBusinessIdentity
    && template.includesUnsubscribe
    && destinationReady,
  );
  const preview = template?.body
    .replaceAll("{{first_name}}", previewName)
    .replaceAll("{{business_name}}", business.name)
    .replaceAll("{{review_link}}", destinationReady && runtimeUrl ? runtimeUrl : "[review destination unavailable]");

  if (!workflow || !channel) {
    return <div className="view-stack"><DemoNotice /><section className="panel empty-state"><Clock3 size={24} /><h2>No messaging policy for this location.</h2><p>The shared backend has not returned an SMS or email workflow for {business.locationName}. Connect the required services before sending review requests.</p><Button onClick={onOpenIntegrations}>Open integrations</Button></section></div>;
  }

  return (
    <div className="automation-layout">
      <section className="automation-canvas panel">
        <header className="automation-canvas__head">
          <div><h2>Google review request policy</h2><p>{business.locationName} · rule {channel.ruleVersion} · {channel.timezone}</p></div>
          <div className="automation-canvas__controls">
            {channels.length > 1 && <label className="select-field"><span className="sr-only">Messaging channel</span><select value={channel.channel} onChange={(event) => setSelectedChannel(event.target.value as "sms" | "email")}>{channels.map((candidate) => <option key={candidate.channel} value={candidate.channel}>{candidate.channel.toUpperCase()} · {candidate.enabled ? "enabled" : "disabled"}</option>)}</select><ChevronDown size={15} aria-hidden="true" /></label>}
            <StatusPill tone={configured ? "success" : channel.enabled ? "warning" : "muted"}>{configured ? "Configured" : channel.enabled ? "Incomplete" : "Disabled"}</StatusPill>
          </div>
        </header>
        <div className="automation-access-note"><ShieldCheck size={16} /><span>{IS_DEMO_MODE ? "This is a seeded demo policy." : "This read-only view comes from the selected location’s messaging policy, approved template and Google destination."} Changes remain protected by backend permissions.</span></div>
        <div className="automation-guardrail">
          <ShieldCheck size={17} />
          <span><strong>Review gating blocked</strong> · {channel.sendWindowStart}–{channel.sendWindowEnd} sending window · maximum {touchCount} {touchCount === 1 ? "message" : "messages"}</span>
        </div>
        <div className="automation-flow">
          {nodes.map((node, index) => {
            const Icon = node.icon;
            return (
              <div className="automation-flow__item" key={node.id}>
                <button type="button" className={cx("automation-node", selectedNode.id === node.id && "is-selected")} onClick={() => setSelected(node.id)}>
                  <span><Icon size={18} /></span>
                  <span><strong>{node.label}</strong><small>{node.description}</small></span>
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
                {index < nodes.length - 1 && <span className="automation-connector" aria-hidden="true"><Circle size={7} /></span>}
              </div>
            );
          })}
        </div>
      </section>
      <aside className="automation-editor panel">
        <header className="automation-editor__head"><span><SelectedIcon size={18} /></span><div><small>Workflow step</small><h2>{selectedNode.label}</h2></div></header>
        {selectedNode.message ? template ? (
          <>
            <div className={cx("template-validation", (!template.includesBusinessIdentity || !template.includesUnsubscribe || !destinationReady) && "template-validation--warning")} role="status"><ShieldCheck size={17} /><span><strong>{template.includesBusinessIdentity && template.includesUnsubscribe && destinationReady ? "Required template evidence present" : "Workflow configuration incomplete"}</strong><small>Business identity: {template.includesBusinessIdentity ? "present" : "missing"} · opt-out: {template.includesUnsubscribe ? "present" : "missing"} · Google destination: {destinationReady ? "ready" : "unavailable"}{connectionHealth ? ` (${connectionHealth.replaceAll("_", " ")})` : ""}.</small></span></div>
            {workflow.reviewDestination?.qrUrl && !workflow.reviewDestination.matchesRuntime && <div className="workspace-inline-error" role="alert"><AlertTriangle size={17} /><span>The runtime Google destination and QR destination do not match. Sending remains a backend-controlled operation.</span></div>}
            <figure className="message-preview"><figcaption>Approved template v{template.version}</figcaption><div><p>{preview}</p><span>{channel.channel.toUpperCase()} preview · approved {template.approvedAt}</span></div></figure>
          </>
        ) : <div className="empty-state"><AlertTriangle size={22} /><h3>No approved template.</h3><p>This policy cannot send until an active template version is available.</p><Button onClick={onOpenIntegrations}>Check integrations</Button></div> : (
          <div className="editor-summary"><SelectedIcon size={22} /><h3>{selectedNode.label}</h3><p>{selectedNode.description}. This backend policy step has no customer-facing copy.</p></div>
        )}
      </aside>
    </div>
  );
}

function ReviewsView({ business, reviews }: { business: BusinessAccount; reviews: ReviewRecord[] }) {
  const awaitingReply = reviews.filter((review) => !review.replied).length;
  return (
    <div className="view-stack">
      <DemoNotice />
      <section className="reviews-summary">
        <div><span>Current rating</span><strong>{business.metrics.rating.toFixed(1)}</strong><Stars rating={Math.round(business.metrics.rating)} size={18} /><small>{business.metrics.totalReviews} Google reviews{IS_DEMO_MODE ? " · sample" : ""}</small></div>
        <div><span>{IS_DEMO_MODE ? "Detected this month" : "Current cache"}</span><strong>{business.metrics.reviewsDetected}</strong><small>{IS_DEMO_MODE ? `Last sync · ${business.lastSuccess}` : `Google sync · ${business.integrations.google.lastEvent}`}</small></div>
        <div><span>Awaiting reply</span><strong>{awaitingReply}</strong><small>Owner replies remain on Google</small></div>
      </section>
      <section className="panel review-feed-panel">
        <header className="panel__head"><div><h2>Google review feed</h2><p>{business.name} · {business.locationName}{IS_DEMO_MODE ? " · sample data" : ""}</p></div><StatusPill tone={IS_DEMO_MODE ? business.healthTone : business.integrations.google.tone}>{(IS_DEMO_MODE ? business.healthTone : business.integrations.google.tone) === "success" && <CheckCircle2 size={14} />} {IS_DEMO_MODE ? business.healthTone === "success" ? "Sync healthy" : "Check integration" : business.integrations.google.status}</StatusPill></header>
        {reviews.length > 0 ? (
          <div className="review-feed">
            {reviews.map((review) => (
              <article key={review.id}>
                <div className="review-feed__top"><span className="review-avatar">{review.name[0]}</span><span><strong>{review.name}</strong><small>{review.date}</small></span><Stars rating={review.rating} /></div>
                <p>{review.body}</p>
                <div><StatusPill tone={review.replied ? "neutral" : "warning"}>{review.replied ? <><Check size={13} /> Replied</> : "Reply pending"}</StatusPill><small className="review-feed__provider-status">{IS_DEMO_MODE ? "Sample review" : "Open the original review in Google Business Profile"}</small></div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state"><Star size={22} /><h2>No Google reviews are cached yet.</h2><p>Reviews will appear after a successful Google Business Profile sync.</p></div>
        )}
      </section>
    </div>
  );
}

function ReportsView({ business, selectedBusiness }: { business: BusinessAccount; selectedBusiness: BusinessAccount }) {
  const [combined, setCombined] = useState(false);
  const locationReports = business.locationReports ?? [];
  useEffect(() => setCombined(false), [selectedBusiness.locationId]);
  const combinedMetrics = useMemo(() => {
    const totalReviews = locationReports.reduce((sum, location) => sum + location.totalReviews, 0);
    const weightedRating = totalReviews > 0
      ? locationReports.reduce((sum, location) => sum + (location.rating * location.totalReviews), 0) / totalReviews
      : 0;
    return {
      ...business.metrics,
      completedJobs: locationReports.reduce((sum, location) => sum + location.completedJobs, 0),
      delivered: locationReports.reduce((sum, location) => sum + location.delivered, 0),
      uniqueClicks: locationReports.reduce((sum, location) => sum + location.uniqueClicks, 0),
      reviewsDetected: locationReports.reduce((sum, location) => sum + location.reviewsDetected, 0),
      rating: weightedRating,
      totalReviews,
    };
  }, [business.metrics, locationReports]);
  const isCombinedReport = combined && locationReports.length > 1;
  const reportBusiness = isCombinedReport ? { ...business, metrics: combinedMetrics } : selectedBusiness;
  const metrics = reportBusiness.metrics;
  const operationalTone = reportBusiness.healthTone === "success" ? "success" : "warning";
  const generatedOn = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(new Date());
  const integrationChecks = [
    { label: "Completed-job intake", state: reportBusiness.integrations.jobIntake },
    { label: "Google review sync", state: reportBusiness.integrations.google },
    { label: "Messaging delivery", state: reportBusiness.integrations.messaging },
  ];
  return (
    <div className="view-stack">
      <DemoNotice />
      <section className="report-shell">
        <header className="report-toolbar"><div><span>{IS_DEMO_MODE ? "Monthly report" : "Operational snapshot"}</span><strong>{IS_DEMO_MODE ? "July 2026" : generatedOn}</strong></div><div className="report-toolbar__actions">{locationReports.length > 1 && <div className="report-scope-toggle" aria-label="Report scope"><button type="button" className={!combined ? "is-active" : undefined} onClick={() => setCombined(false)}>Selected location</button><button type="button" className={combined ? "is-active" : undefined} onClick={() => setCombined(true)}>All locations</button></div>}<Button variant="secondary" onClick={() => window.print()}><Printer size={16} /> Print report</Button></div></header>
        <article className="report-paper">
          <header><Brand /><span>{reportBusiness.name} · {isCombinedReport ? `Combined ${locationReports.length}-location report` : reportBusiness.locationName}</span><small>{IS_DEMO_MODE ? "1–31 July 2026 · Sample report" : `Generated ${generatedOn} · Authenticated current totals`}</small></header>
          <section className="report-intro"><p>{IS_DEMO_MODE ? reportBusiness.healthTone === "success" ? "Your review-request system ran without an integration failure this month." : `The system protected customer messaging while ${reportBusiness.health.toLowerCase()} needs attention.` : reportBusiness.healthTone === "success" ? "Current durable records show the configured review-request system operating without a reported integration failure." : `Customer messaging remains protected while ${reportBusiness.health.toLowerCase()} needs attention.`}</p><span className={`status-pill status-pill--${operationalTone}`}>{reportBusiness.healthTone === "success" ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />} {reportBusiness.health}</span></section>
          <section className="report-metrics"><div><span>Completed jobs</span><strong>{metrics.completedJobs}</strong></div><div><span>Requests delivered</span><strong>{metrics.delivered}</strong></div><div><span>Unique link clicks</span><strong>{metrics.uniqueClicks}</strong></div><div><span>{IS_DEMO_MODE ? "New reviews detected" : "Reviews cached"}</span><strong>{metrics.reviewsDetected}</strong></div></section>
          <section className="report-rating"><div><span>Google rating</span><strong>{metrics.rating.toFixed(1)}</strong><Stars rating={Math.round(metrics.rating)} size={17} /></div><p>{IS_DEMO_MODE ? `${metrics.totalReviews} total reviews at month end.` : `${metrics.totalReviews} total Google reviews in the current snapshot.`} Review detection is not exact job-level attribution; estimated conversion is reported separately.</p></section>
          {isCombinedReport && <section className="report-locations"><h2>Location performance</h2><div className="report-locations__table" role="table" aria-label="Location-level report"><div className="report-locations__head" role="row"><span role="columnheader">Location</span><span role="columnheader">Jobs</span><span role="columnheader">Delivered</span><span role="columnheader">Clicks</span><span role="columnheader">Reviews</span><span role="columnheader">Rating</span><span role="columnheader">SMS</span></div>{locationReports.map((location) => <div role="row" key={location.id}><strong role="cell">{location.name}</strong><span role="cell">{location.completedJobs}</span><span role="cell">{location.delivered}</span><span role="cell">{location.uniqueClicks}</span><span role="cell">{location.reviewsDetected}</span><span role="cell">{location.rating.toFixed(1)}</span><span role="cell">{location.smsSegments}</span></div>)}</div><p>Combined totals appear above. Each row is calculated from records scoped to that location.</p></section>}
          {IS_DEMO_MODE ? (
            <section className="report-events"><h2>Operational checks</h2><div><span><CheckCircle2 size={16} /> Completed-job trigger</span><strong>Healthy</strong></div><div><span>{reportBusiness.healthTone === "success" ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />} Google review sync</span><strong>{reportBusiness.healthTone === "success" ? "Healthy" : "Attention"}</strong></div><div><span><CheckCircle2 size={16} /> Suppression list</span><strong>4 contacts</strong></div><div><span><AlertTriangle size={16} /> Failed delivery rate</span><strong>2.4%</strong></div></section>
          ) : (
            <section className="report-events"><h2>Operational checks</h2>{integrationChecks.map((check) => <div key={check.label}><span>{check.state.tone === "success" ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />} {check.label}</span><strong>{check.state.status}</strong></div>)}<div><span><AlertTriangle size={16} /> Review attribution</span><strong>Estimated</strong></div></section>
          )}
          <footer><span>Review Anchor · Review automation</span><span>{IS_DEMO_MODE ? "Sample data · Not a live client report" : "Authenticated tenant report"}</span></footer>
        </article>
      </section>
    </div>
  );
}

function IntegrationsView({ business, onConnect, canConfigure, services, servicesLoading }: { business: BusinessAccount; onConnect: () => void; canConfigure: boolean; services: ServiceStatus[]; servicesLoading: boolean }) {
  const integrations = [
    { key: "google", name: "Google Business Profile", detail: "Review sync and direct review destination", state: business.integrations.google, icon: MapPin },
    { key: "messaging", name: "Messaging provider", detail: "SMS and email delivery events", state: business.integrations.messaging, icon: Send },
    { key: "jobIntake", name: "Completed-job intake", detail: "Receives genuine customer job completions", state: business.integrations.jobIntake, icon: Webhook },
  ];
  const attentionCount = integrations.filter((integration) => integration.state.tone !== "success").length;
  const googleService = services.find((service) => service.key === "google");
  const googleAvailable = googleService?.configured ?? false;
  return (
    <div className="view-stack">
      <DemoNotice />
      <section className="integration-grid">
        {integrations.map((integration) => {
          const Icon = integration.icon;
          const isGoogle = integration.key === "google";
          const blocked = isGoogle && !IS_DEMO_MODE && (servicesLoading || !googleAvailable);
          return (
            <article className="integration-card" key={integration.name}>
              <span className="integration-card__icon"><Icon size={22} /></span>
              <div><h2>{integration.name}</h2><p>{integration.detail}</p></div>
              <StatusPill tone={blocked ? "warning" : integration.state.tone}>{blocked ? "Not configured" : integration.state.status}</StatusPill>
              {isGoogle && IS_DEMO_MODE ? (
                <small className="integration-card__status-note">Connection setup requires an authenticated deployment and is unavailable in the seeded demo.</small>
              ) : isGoogle ? (
                <Button variant="secondary" disabled={!canConfigure || blocked} onClick={!blocked ? onConnect : undefined}>
                  {servicesLoading && !IS_DEMO_MODE ? "Checking availability…" : blocked ? "Unavailable" : "Review setup"}
                </Button>
              ) : <small className="integration-card__status-note">Status is read from the shared workspace backend.</small>}
            </article>
          );
        })}
      </section>
      {!IS_DEMO_MODE && services.length > 0 && (
        <section className="panel integration-log">
          <header className="panel__head">
            <div><h2>Service availability</h2><p>What this deployment can currently do</p></div>
            <StatusPill tone={services.every((service) => service.configured) ? "success" : "warning"}>
              {services.filter((service) => service.configured).length}/{services.length} configured
            </StatusPill>
          </header>
          {services.map((service) => (
            <div key={service.key}>
              <span>
                {service.configured ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />} {service.label}
              </span>
              <small>
                {service.detail}
                {!service.configured && service.requires.length > 0 && ` Needs: ${service.requires.join(", ")}.`}
              </small>
            </div>
          ))}
        </section>
      )}
      <section className="panel integration-log">
        <header className="panel__head"><div><h2>Integration event log</h2><p>{IS_DEMO_MODE ? "Latest sample events" : "Latest provider state"} · {business.name}</p></div><StatusPill tone={attentionCount ? "warning" : "success"}>{attentionCount ? `${attentionCount} need attention` : "No failures"}</StatusPill></header>
        {integrations.map((integration) => <div key={integration.key}><span>{integration.state.tone === "success" ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />} {integration.name}</span><small>{integration.state.lastEvent}</small></div>)}
      </section>
    </div>
  );
}

function AddJobDialog({ open, onClose, onAdd, locationId, demoMode }: { open: boolean; onClose: () => void; onAdd: (draft: CompletedJobDraft) => Promise<void>; locationId?: string; demoMode: boolean }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [job, setJob] = useState("");
  const [channel, setChannel] = useState<Channel>("SMS");
  const [destination, setDestination] = useState("");
  const [consentBasis, setConsentBasis] = useState("Booking form consent");
  const [consentReference, setConsentReference] = useState("");
  const [consentCapturedAt, setConsentCapturedAt] = useState("");
  const [consentWordingVersion, setConsentWordingVersion] = useState("review_request_v2");
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const evidenceMissing = consentBasis === "Evidence missing";
  const phoneDigits = destination.replace(/\D/g, "");
  const destinationValid = channel === "SMS"
    ? phoneDigits.length >= 10 && phoneDigits.length <= 15
    : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination.trim());
  const consentEvidenceValid = evidenceMissing || Boolean(consentReference.trim() && consentCapturedAt && consentWordingVersion.trim());
  const invalid = !firstName.trim() || !job.trim() || !destinationValid || !consentEvidenceValid;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (invalid) return;
    setSaving(true);
    setSubmitError("");
    const occurredAt = new Date().toISOString();
    const transactionReference = consentReference.trim() || `MANUAL-${Date.now().toString(36).toUpperCase()}`;
    try {
      await onAdd({
        locationId,
        externalJobId: transactionReference,
        serviceLabel: job.trim(),
        occurredAt,
        firstName: firstName.trim(),
        lastName: lastName.trim() || undefined,
        phone: channel === "SMS" ? destination.trim() : undefined,
        email: channel === "Email" ? destination.trim() : undefined,
        preferredChannel: channel,
        consent: {
          status: evidenceMissing ? "unknown" : "granted",
          wording: evidenceMissing ? "No consent wording supplied" : "I agree to receive a service follow-up and neutral review request.",
          wordingVersion: evidenceMissing ? "not_supplied" : consentWordingVersion.trim(),
          purpose: "customer_review_request",
          capturedAt: evidenceMissing ? occurredAt : new Date(consentCapturedAt).toISOString(),
          source: consentBasis,
          transactionReference,
          evidenceReference: evidenceMissing ? undefined : consentReference.trim(),
        },
      });
      setFirstName(""); setLastName(""); setJob(""); setDestination("");
      setConsentBasis("Booking form consent"); setConsentReference(""); setConsentCapturedAt(""); setConsentWordingVersion("review_request_v2");
      setTouched(false);
      onClose();
    } catch (caught) {
      setSubmitError(caught instanceof Error ? caught.message : "The completed job could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} label="Add a completed job">
      <form className="dialog-card" onSubmit={submit} noValidate>
        <header className="dialog-card__head"><div><span className="dialog-icon"><ClipboardCheck size={20} /></span><div><small>{demoMode ? "Demo workflow" : "Authenticated workflow"}</small><h2>Add a completed job</h2></div></div><IconButton label="Close dialog" onClick={onClose}><X size={19} /></IconButton></header>
        <div className={cx("dialog-note", evidenceMissing ? "dialog-note--warning" : "dialog-note--verified")}>
          {evidenceMissing ? <AlertTriangle size={16} /> : <ShieldCheck size={16} />}
          <span>{evidenceMissing ? "Consent evidence is missing. The completed job will be recorded as blocked and cannot enter the messaging workflow." : demoMode ? "Evidence is checked before the in-memory request is queued. No customer will be contacted in this demo." : "Evidence is checked by the server before the request enters the durable delivery workflow."}</span>
        </div>
        <div className="form-grid">
          <div className="field-group"><label htmlFor="first-name">First name</label><input id="first-name" value={firstName} onBlur={() => setTouched(true)} onChange={(event) => setFirstName(event.target.value)} aria-invalid={touched && !firstName ? "true" : undefined} placeholder="Amelia" /><small className={cx(touched && !firstName && "is-error")}>{touched && !firstName ? "Add the customer’s first name." : "Used for personalisation."}</small></div>
          <div className="field-group"><label htmlFor="last-name">Last name</label><input id="last-name" value={lastName} onChange={(event) => setLastName(event.target.value)} placeholder="Carter" /><small>Optional in customer messages.</small></div>
          <div className="field-group field-group--full"><label htmlFor="job-type">Completed job</label><input id="job-type" value={job} onBlur={() => setTouched(true)} onChange={(event) => setJob(event.target.value)} aria-invalid={touched && !job ? "true" : undefined} placeholder="Boiler service" /><small className={cx(touched && !job && "is-error")}>{touched && !job ? "Name the completed service or transaction." : "This should represent a genuine finished job."}</small></div>
          <div className="field-group"><label htmlFor="job-channel">Channel</label><select id="job-channel" value={channel} onChange={(event) => setChannel(event.target.value as Channel)}><option>SMS</option><option>Email</option></select><small>{demoMode ? "The demo will queue one neutral request." : "The server applies suppression, consent and quiet-hour checks."}</small></div>
          <div className="field-group"><label htmlFor="destination">{channel === "SMS" ? "Mobile number" : "Email address"}</label><input id="destination" type={channel === "SMS" ? "tel" : "email"} value={destination} onBlur={() => setTouched(true)} onChange={(event) => setDestination(event.target.value)} aria-invalid={touched && !destinationValid ? "true" : undefined} placeholder={channel === "SMS" ? "07700 900482" : "amelia@example.com"} /><small className={cx(touched && !destinationValid && "is-error")}>{touched && !destinationValid ? `Add a valid ${channel === "SMS" ? "mobile number" : "email address"}.` : demoMode ? "Stored as masked demo data." : "Encrypted before persistence; only masked values return to the browser."}</small></div>
          <div className="field-group field-group--full"><label htmlFor="consent-basis">Consent evidence source</label><select id="consent-basis" value={consentBasis} onChange={(event) => setConsentBasis(event.target.value)}><option>Booking form consent</option><option>Service agreement consent</option><option>CRM consent record</option><option>Evidence missing</option></select><small>A customer relationship alone is not treated as consent evidence.</small></div>
          {!evidenceMissing && <>
            <div className="field-group"><label htmlFor="consent-reference">Booking or transaction reference</label><input id="consent-reference" value={consentReference} onBlur={() => setTouched(true)} onChange={(event) => setConsentReference(event.target.value)} aria-invalid={touched && !consentReference.trim() ? "true" : undefined} placeholder="JOB-2841" /><small className={cx(touched && !consentReference.trim() && "is-error")}>{touched && !consentReference.trim() ? "Add the evidence or transaction reference." : "Links this request to the source evidence."}</small></div>
            <div className="field-group"><label htmlFor="consent-captured-at">Consent captured at</label><input id="consent-captured-at" type="datetime-local" value={consentCapturedAt} onBlur={() => setTouched(true)} onChange={(event) => setConsentCapturedAt(event.target.value)} aria-invalid={touched && !consentCapturedAt ? "true" : undefined} /><small className={cx(touched && !consentCapturedAt && "is-error")}>{touched && !consentCapturedAt ? "Record when permission was captured." : "Stored with the evidence record."}</small></div>
            <div className="field-group field-group--full"><label htmlFor="consent-wording-version">Consent wording version</label><input id="consent-wording-version" value={consentWordingVersion} onBlur={() => setTouched(true)} onChange={(event) => setConsentWordingVersion(event.target.value)} aria-invalid={touched && !consentWordingVersion.trim() ? "true" : undefined} /><small className={cx(touched && !consentWordingVersion.trim() && "is-error")}>{touched && !consentWordingVersion.trim() ? "Record the exact wording version shown to the customer." : "The production record also retains the approved wording and withdrawal history."}</small></div>
          </>}
        </div>
        {submitError && <div className="dialog-error" role="alert"><AlertTriangle size={16} /> {submitError}</div>}
        <footer className="dialog-card__actions"><Button variant="quiet" onClick={onClose}>Cancel</Button><Button type="submit" state={saving ? "loading" : undefined}>{saving ? "Adding job…" : evidenceMissing ? "Add blocked record" : "Add and queue request"}</Button></footer>
      </form>
    </Modal>
  );
}

function SupportSessionBanner({ supportSession, business, actor, onEnd, ending }: { supportSession: SupportSession; business: BusinessAccount; actor: string; onEnd: () => void; ending: boolean }) {
  const expiresAt = new Date(supportSession.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="support-session-banner" role="status">
      <span className="support-session-banner__icon"><ShieldCheck size={18} /></span>
      <span><strong>Audited support session · {supportSession.scope === "configuration" ? "Configuration" : "View only"}</strong><small>{actor} is accessing {business.name} · reason recorded · expires {expiresAt}</small></span>
      <Button variant="secondary" onClick={onEnd} disabled={ending} state={ending ? "loading" : undefined}>{ending ? "Ending…" : "End session"}</Button>
    </div>
  );
}

function SupportSessionDialog({ business, session, onClose, onStart }: { business: BusinessAccount | null; session: SessionContext; onClose: () => void; onStart: (input: { scope: SupportScope; reason: string; durationMinutes: 15 | 30 }) => Promise<void> | void }) {
  const [scope, setScope] = useState<SupportScope>("view");
  const [reason, setReason] = useState("Investigate integration exception");
  const [durationMinutes, setDurationMinutes] = useState<15 | 30>(15);
  const [submitting, setSubmitting] = useState(false);
  const [touched, setTouched] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const reasonInvalid = reason.trim().length < 12;
  const stepUpAge = session.stepUpVerifiedAt ? Date.now() - new Date(session.stepUpVerifiedAt).getTime() : Number.POSITIVE_INFINITY;
  const stepUpFresh = stepUpAge >= 0 && stepUpAge <= 10 * 60 * 1000;
  const configurationBlocked = scope === "configuration" && !stepUpFresh;
  const invalid = reasonInvalid || configurationBlocked;

  useEffect(() => {
    if (!business) return;
    setScope("view");
    setReason("Investigate integration exception");
    setDurationMinutes(15);
    setTouched(false);
    setSubmitError("");
  }, [business]);

  if (!business) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (invalid) return;
    setSubmitting(true);
    try {
      await onStart({ scope, reason: reason.trim(), durationMinutes });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Support access could not be started.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open onClose={onClose} label={`Start support session for ${business.name}`}>
      <form className="dialog-card support-dialog" onSubmit={submit} noValidate>
        <header className="dialog-card__head"><div><span className="dialog-icon"><ShieldCheck size={20} /></span><div><small>Explicit agency access</small><h2>Start audited support session</h2></div></div><IconButton label="Close support dialog" onClick={onClose}><X size={19} /></IconButton></header>
        <div className="support-target"><span className="client-avatar">{business.initials}</span><span><strong>{business.name}</strong><small>{business.locationName} · {business.health}</small></span></div>
        <div className="dialog-note"><ShieldCheck size={16} /><span>MFA is active. The actor, tenant, reason, scope, expiry and every privileged action are recorded.</span></div>
        <div className="form-grid">
          <div className="field-group field-group--full"><label htmlFor="support-reason">Support reason</label><input id="support-reason" value={reason} onBlur={() => setTouched(true)} onChange={(event) => { setReason(event.target.value); setSubmitError(""); }} aria-invalid={touched && reasonInvalid ? "true" : undefined} /><small className={cx(touched && reasonInvalid && "is-error")}>{touched && reasonInvalid ? "Record a specific reason of at least 12 characters." : "Required and visible in the audit log."}</small></div>
          <div className="field-group"><label htmlFor="support-scope">Access scope</label><select id="support-scope" value={scope} onChange={(event) => { setScope(event.target.value as SupportScope); setSubmitError(""); }}><option value="view">View only</option><option value="configuration">Configuration</option></select><small>Configuration allows tenant changes during this session.</small></div>
          <div className="field-group"><label htmlFor="support-duration">Session length</label><select id="support-duration" value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value) as 15 | 30)}><option value={15}>15 minutes</option><option value={30}>30 minutes</option></select><small>Access expires automatically.</small></div>
        </div>
        {scope === "configuration" && <div className={cx("step-up-confirmation", !stepUpFresh && "step-up-confirmation--warning")}>{stepUpFresh ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}<span><strong>{stepUpFresh ? "Recent step-up verified" : "Step-up verification required"}</strong><small>{stepUpFresh ? "Verified within the last 10 minutes." : "Configuration access remains blocked until MFA is verified again."}</small></span></div>}
        {submitError && <div className="dialog-error" role="alert"><AlertTriangle size={16} /> {submitError}</div>}
        <footer className="dialog-card__actions"><Button variant="quiet" onClick={onClose}>Cancel</Button><Button type="submit" disabled={invalid || submitting}><ShieldCheck size={16} /> {submitting ? "Starting…" : "Start session"}</Button></footer>
      </form>
    </Modal>
  );
}

function GoogleProfileSelectionDialog({
  selection,
  loading,
  error,
  saving,
  onConfirm,
  onClose,
}: {
  selection: GoogleProfileSelectionPayload | null;
  loading: boolean;
  error: string;
  saving: boolean;
  onConfirm: (profileIndex: number) => void;
  onClose: () => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(-1);

  useEffect(() => {
    if (!selection) return;
    const firstAvailable = selection.profiles.find((profile) => profile.reviewDestinationAvailable)?.profileIndex ?? -1;
    setSelectedIndex((current) => selection.profiles.some(
      (profile) => profile.profileIndex === current && profile.reviewDestinationAvailable,
    ) ? current : firstAvailable);
  }, [selection]);

  return (
    <Modal open onClose={saving ? () => undefined : onClose} label="Choose a Google Business Profile location" className="dialog--wide">
      <div className="dialog-card">
        <header className="dialog-card__head">
          <div><span className="dialog-icon"><MapPin size={20} /></span><div><small>Google Business Profile</small><h2>Choose the location to connect</h2></div></div>
          <IconButton label="Close Google profile selection" onClick={onClose} disabled={saving}><X size={19} /></IconButton>
        </header>
        <p className="dialog-explainer">The selected Google location will be permanently bound to this Review Anchor business location. Customers still review the business directly on Google.</p>
        {loading && <div className="empty-state"><Activity size={22} /><h2>Loading verified locations…</h2></div>}
        {error && <div className="dialog-note"><AlertTriangle size={16} /><span>{error}</span></div>}
        {!loading && selection && <div className="profile-selection-list">
          {selection.profiles.map((profile) => (
            <label key={profile.profileIndex} className={cx("choice-card", selectedIndex === profile.profileIndex && "is-selected", !profile.reviewDestinationAvailable && "is-disabled")}>
              <input
                type="radio"
                name="google-profile"
                checked={selectedIndex === profile.profileIndex}
                disabled={!profile.reviewDestinationAvailable || saving}
                onChange={() => setSelectedIndex(profile.profileIndex)}
              />
              <span className="choice-card__icon"><Building2 size={20} /></span>
              <span><strong>{profile.locationTitle}</strong><small>{profile.accountDisplayName}{profile.reviewDestinationAvailable ? " · Direct review link verified" : " · Direct review link unavailable"}</small></span>
              {profile.reviewDestinationAvailable && <CheckCircle2 size={18} />}
            </label>
          ))}
        </div>}
        <footer className="dialog-card__actions">
          <Button variant="quiet" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => onConfirm(selectedIndex)} disabled={loading || saving || selectedIndex < 0}>{saving ? "Connecting…" : "Connect this location"}</Button>
        </footer>
      </div>
    </Modal>
  );
}

function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const parsedRoute = useMemo(() => parseWorkspaceRoute(location.pathname, location.search), [location.pathname, location.search]);
  const searchContext = useMemo(() => workspaceContextFromSearch(location.search), [location.search]);
  const routeContext = parsedRoute ?? searchContext;
  const requestedView = parsedRoute?.view ?? "home";
  const googleProfileTab = parsedRoute?.googleProfileTab ?? "profile";
  const contentTab = parsedRoute?.contentTab ?? "create";
  const parsedSettingsBillingTab = parsedRoute?.settingsBillingTab ?? "connections";
  const compactViewport = useMediaQuery("(max-width: 59.999rem)");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [addJobOpen, setAddJobOpen] = useState(false);
  const [session, setSession] = useState<SessionContext | null>(IS_DEMO_MODE ? OWNER_SESSION : null);
  const settingsBillingTab = session?.businessRole === "billing" ? "billing" : parsedSettingsBillingTab;
  const [workspaceState, setWorkspaceState] = useState<WorkspaceLoadState>(IS_DEMO_MODE ? "authenticated" : "loading");
  const [workspaceError, setWorkspaceError] = useState("");
  const [workspaceNotice, setWorkspaceNotice] = useState<WorkspaceNotice | null>(null);
  const [workspaceAccess, setWorkspaceAccess] = useState<WorkspaceAccess | undefined>();
  const [supportSession, setSupportSession] = useState<SupportSession | null>(null);
  const [endingSupportSession, setEndingSupportSession] = useState(false);
  const [, refreshPermissionClock] = useState(0);
  const [selectedBusinessId, setSelectedBusinessId] = useState(
    routeContext.businessId ?? (IS_DEMO_MODE ? OWNER_SESSION.businessId ?? BUSINESSES[0].id : ""),
  );
  const [supportDialogBusiness, setSupportDialogBusiness] = useState<BusinessAccount | null>(null);
  const [businesses, setBusinesses] = useState<BusinessAccount[]>(IS_DEMO_MODE ? BUSINESSES : []);
  const [requestsByBusiness, setRequestsByBusiness] = useState<Record<string, RequestRecord[]>>(() => Object.fromEntries(
    IS_DEMO_MODE ? Object.entries(INITIAL_REQUESTS_BY_BUSINESS).map(([businessId, requests]) => [businessId, [...requests]]) : [],
  ));
  const [reviewsByBusiness, setReviewsByBusiness] = useState<Record<string, ReviewRecord[]>>(IS_DEMO_MODE ? REVIEWS_BY_BUSINESS : {});
  const [platformExceptions, setPlatformExceptions] = useState(IS_DEMO_MODE ? PLATFORM_EXCEPTIONS : []);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>(IS_DEMO_MODE ? INITIAL_AUDIT_EVENTS : []);
  const [qrCodesByBusiness, setQrCodesByBusiness] = useState<Record<string, QrCodeRecord>>(() => Object.fromEntries(
    IS_DEMO_MODE ? Object.entries(INITIAL_QR_CODES_BY_BUSINESS).map(([businessId, record]) => [businessId, { ...record, placements: record.placements.map((placement) => ({ ...placement })) }]) : [],
  ));
  const [workflowsByLocation, setWorkflowsByLocation] = useState<Record<string, LocationWorkflowSummary>>({});
  const selectionToken = useMemo(
    () => !IS_DEMO_MODE ? new URLSearchParams(location.search).get("selection") : null,
    [location.search],
  );
  const [googleProfileSelection, setGoogleProfileSelection] = useState<GoogleProfileSelectionPayload | null>(null);
  const [googleSelectionLoading, setGoogleSelectionLoading] = useState(Boolean(selectionToken));
  const [googleSelectionSaving, setGoogleSelectionSaving] = useState(false);
  const [googleSelectionError, setGoogleSelectionError] = useState("");
  const [billingRefreshPending, setBillingRefreshPending] = useState(false);
  const [supportAccessObservedAt, setSupportAccessObservedAt] = useState<number | null>(null);
  const stripeCheckoutAttempts = useRef(new Map<string, string>());
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [servicesLoading, setServicesLoading] = useState(!IS_DEMO_MODE);
  const [servicesError, setServicesError] = useState("");
  const [servicesVersion, setServicesVersion] = useState(0);
  const sessionRef = useRef<SessionContext | null>(session);
  const previousDemoRoleRef = useRef<ActorRole | null>(session?.role ?? null);

  const navigateToView = (
    nextView: AppView,
    context: { businessId?: string; locationId?: string; googleProfileTab?: "profile" | "reviews" | "requests-qr" | "posts-media"; contentTab?: "create" | "uploads" | "approvals" | "scheduled" | "published" | "failed"; settingsBillingTab?: "connections" | "billing"; replace?: boolean } = {},
  ) => {
    const destinationContext = nextView === "settings-billing" && session?.businessRole === "billing"
      ? { ...context, settingsBillingTab: "billing" as const }
      : context;
    if (session?.role === "agency_admin" && !supportSession) {
      navigate(workspaceRoute(nextView, destinationContext, location.search), { replace: destinationContext.replace });
      return;
    }
    const currentBusinessId = supportSession?.businessId ?? session?.businessId ?? routeContext.businessId ?? selectedBusinessId;
    const businessId = destinationContext.businessId ?? currentBusinessId;
    const selectedBusiness = businesses.find((item) => item.id === businessId);
    const locationId = workspaceLocationForBusiness(
      routeContext,
      businessId,
      destinationContext.locationId,
      selectedBusiness?.locationId ?? selectedBusiness?.locationReports?.[0]?.id,
    );
    navigate(workspaceRoute(nextView, { ...destinationContext, businessId, locationId }, location.search), { replace: destinationContext.replace });
  };

  useEffect(() => {
    if (!IS_DEMO_MODE || !session) return;
    const previousRole = previousDemoRoleRef.current;
    previousDemoRoleRef.current = session.role;
    if (!previousRole || previousRole === session.role) return;
    const ownerBusinessId = OWNER_SESSION.businessId ?? BUSINESSES[0]?.id;
    const ownerBusiness = BUSINESSES.find((candidate) => candidate.id === ownerBusinessId);
    const targetRoute = session.role === "agency_admin"
      ? workspaceRoute("agency")
      : workspaceRoute("home", {
        businessId: ownerBusinessId,
        locationId: ownerBusiness?.locationId,
      });
    const frame = window.requestAnimationFrame(() => navigate(targetRoute, { replace: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [navigate, session?.role]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
    return () => window.cancelAnimationFrame(frame);
  }, [requestedView]);

  useEffect(() => {
    if (IS_DEMO_MODE) return;
    const params = new URLSearchParams(location.search);
    const googleResult = params.get("google");
    const checkoutResult = params.get("checkout");
    const billingResult = params.get("billing");
    if (googleResult === "selection_required") return;

    let notice: WorkspaceNotice | null = null;
    if (googleResult === "connected") {
      notice = { tone: "success", message: "Google Business Profile was connected to this location." };
    } else if (googleResult === "error") {
      const reason = params.get("reason");
      notice = {
        tone: "error",
        message: reason === "access_denied" || reason === "authorization_cancelled"
          ? "Google connection was cancelled. No account changes were made."
          : "Google Business Profile could not be connected. Check the integration and try again.",
      };
    } else if (checkoutResult === "success") {
      notice = { tone: "warning", message: "Returned from Stripe Checkout. Verified billing status is refreshing." };
      setBillingRefreshPending(true);
    } else if (checkoutResult === "cancelled") {
      notice = { tone: "warning", message: "Stripe Checkout was cancelled. No subscription changes were made." };
    } else if (billingResult === "return") {
      notice = { tone: "warning", message: "Returned from the Stripe billing portal. Verified billing status is refreshing." };
      setBillingRefreshPending(true);
    }
    if (!notice) return;

    setWorkspaceNotice(notice);
    for (const key of ["google", "reason", "checkout", "billing", "session_id"]) params.delete(key);
    const search = params.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : "" }, { replace: true });
  }, [location.pathname, location.search, navigate]);

  const applyWorkspace = (workspace: WorkspacePayload) => {
    sessionRef.current = workspace.session;
    setSession(workspace.session);
    setBusinesses(workspace.businesses);
    setRequestsByBusiness(workspace.requestsByBusiness);
    setReviewsByBusiness(workspace.reviewsByBusiness);
    setQrCodesByBusiness(workspace.qrCodesByBusiness);
    setWorkflowsByLocation(workspace.workflowsByLocation);
    setWorkspaceAccess(workspace.access);
    setPlatformExceptions(workspace.exceptions);
    setAuditEvents(workspace.auditEvents);
    if (!IS_DEMO_MODE && workspace.session.role === "agency_admin") setSupportAccessObservedAt(Date.now());
    setSelectedBusinessId((current) => {
      if (current && workspace.businesses.some((item) => item.id === current)) return current;
      return workspace.session.businessId ?? workspace.businesses[0]?.id ?? "";
    });
  };

  useEffect(() => {
    if (IS_DEMO_MODE || !billingRefreshPending || workspaceState !== "authenticated" || !session) return;
    const businessId = routeContext.businessId ?? session.businessId;
    if (!businessId) {
      setBillingRefreshPending(false);
      setWorkspaceNotice({ tone: "error", message: "Billing status could not be refreshed because no business context is selected." });
      return;
    }

    let cancelled = false;
    let timer: number | undefined;
    const refresh = async (attempt: number) => {
      try {
        const workspace = await platformApi.getWorkspace(businessId, routeContext.locationId);
        if (cancelled) return;
        applyWorkspace(workspace);
        if (attempt >= 2) {
          setBillingRefreshPending(false);
          setWorkspaceNotice({ tone: "success", message: "Latest verified billing status loaded." });
          return;
        }
      } catch (caught) {
        if (cancelled) return;
        if (attempt >= 2) {
          setBillingRefreshPending(false);
          setWorkspaceNotice({ tone: "error", message: caught instanceof Error ? `Billing status could not be refreshed: ${caught.message}` : "Billing status could not be refreshed." });
          return;
        }
      }
      timer = window.setTimeout(() => void refresh(attempt + 1), 1_500);
    };
    void refresh(0);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [billingRefreshPending, routeContext.businessId, routeContext.locationId, session?.businessId, workspaceState]);

  useEffect(() => {
    if (IS_DEMO_MODE) {
      if (routeContext.businessId && BUSINESSES.some((business) => business.id === routeContext.businessId)) {
        setSelectedBusinessId(routeContext.businessId);
      }
      return;
    }
    let active = true;
    const load = async () => {
      setWorkspaceState("loading");
      setWorkspaceError("");
      try {
        const authenticated = sessionRef.current ?? await platformApi.getSession();
        sessionRef.current = authenticated;
        setSession(authenticated);
        let restoredSupportSession: SupportSession | null = null;
        if (authenticated.role === "agency_admin") {
          const active = await platformApi.getActiveSupportSession();
          if (active) {
            restoredSupportSession = {
              id: active.id,
              actorUserId: authenticated.userId,
              actorName: authenticated.userName,
              businessId: active.businessId,
              reason: "Restored active support session",
              scope: active.scope,
              startedAt: active.startedAt,
              expiresAt: active.expiresAt,
            };
          }
          if (active) setSupportSession(restoredSupportSession);
          else setSupportSession(null);
        }
        const requestedBusinessId = workspaceBusinessForSession(
          routeContext,
          authenticated.role,
          authenticated.businessId,
          restoredSupportSession?.businessId,
        );
        const requestedLocationId = !routeContext.businessId || routeContext.businessId === requestedBusinessId
          ? routeContext.locationId
          : undefined;
        const workspace = await platformApi.getWorkspace(requestedBusinessId, requestedLocationId);
        if (!active) return;
        applyWorkspace(workspace);
        setWorkspaceState("authenticated");
      } catch (caught) {
        if (!active) return;
        if (caught instanceof ApiError && caught.status === 401) {
          platformApi.clearSupportSession();
          sessionRef.current = null;
          setSession(null);
          setWorkspaceState("anonymous");
          return;
        }
        if (caught instanceof ApiError && caught.code === "LOCATION_NOT_FOUND" && routeContext.locationId) {
          navigate(workspaceRoute(requestedView, { ...routeContext, businessId: routeContext.businessId }, location.search), { replace: true });
          return;
        }
        setWorkspaceError(caught instanceof Error ? caught.message : "The workspace could not be loaded.");
        setWorkspaceState("error");
      }
    };
    void load();
    return () => { active = false; };
  }, [routeContext.businessId, routeContext.locationId]);

  useEffect(() => {
    if (IS_DEMO_MODE || workspaceState !== "authenticated") return;
    let active = true;
    setServicesLoading(true);
    setServicesError("");
    void platformApi.getServiceStatus()
      .then((loaded) => { if (active) setServices(loaded); })
      .catch((caught: unknown) => {
        if (active) {
          setServices([]);
          setServicesError(caught instanceof Error ? caught.message : "Service availability could not be loaded.");
        }
      })
      .finally(() => { if (active) setServicesLoading(false); });
    return () => { active = false; };
  }, [servicesVersion, workspaceState]);

  useEffect(() => {
    if (workspaceState !== "authenticated" || !session) return;
    if (selectionToken) return;
    const agencyPortfolioOnly = session.role === "agency_admin" && !supportSession;
    const resolvedView = isAppViewAllowed(requestedView, session.role, Boolean(supportSession), session.businessRole)
      ? requestedView
      : defaultAppView(session.role, Boolean(supportSession), session.businessRole);
    if (agencyPortfolioOnly) {
      const canonicalRoute = workspaceRouteForSession(resolvedView, session.businessRole, routeContext, location.search);
      if (`${location.pathname}${location.search}` !== canonicalRoute) {
        navigate(canonicalRoute, { replace: true });
      }
      return;
    }
    const businessId = supportSession?.businessId ?? session.businessId ?? selectedBusinessId;
    const selectedBusiness = businesses.find((candidate) => candidate.id === businessId);
    if (!businessId || !selectedBusiness) return;
    const routeLocationBelongsToBusiness = (!routeContext.businessId || routeContext.businessId === businessId)
      && Boolean(routeContext.locationId)
      && (selectedBusiness.locationId === routeContext.locationId
        || selectedBusiness.locationReports?.some((candidate) => candidate.id === routeContext.locationId));
    const locationId = routeLocationBelongsToBusiness
      ? routeContext.locationId
      : selectedBusiness.locationId ?? selectedBusiness.locationReports?.[0]?.id;
    const canonicalRoute = workspaceRouteForSession(resolvedView, session.businessRole, { ...routeContext, businessId, locationId }, location.search);
    if (`${location.pathname}${location.search}` !== canonicalRoute) {
      navigate(canonicalRoute, { replace: true });
    }
  }, [businesses, location.pathname, location.search, navigate, requestedView, routeContext.businessId, routeContext.locationId, selectedBusinessId, selectionToken, session, supportSession, workspaceState]);

  useEffect(() => {
    if (IS_DEMO_MODE || workspaceState !== "authenticated" || !selectionToken) return;
    let active = true;
    setGoogleSelectionLoading(true);
    setGoogleSelectionError("");
    void platformApi.getGoogleProfileSelection(selectionToken).then((selection) => {
      if (active) setGoogleProfileSelection(selection);
    }).catch((caught: unknown) => {
      if (active) setGoogleSelectionError(caught instanceof Error ? caught.message : "Google profile selection could not be loaded.");
    }).finally(() => {
      if (active) setGoogleSelectionLoading(false);
    });
    return () => { active = false; };
  }, [selectionToken, workspaceState]);

  useEffect(() => {
    if (!supportSession) return;
    const remaining = new Date(supportSession.expiresAt).getTime() - Date.now();
    const expire = () => {
      const expiredSession = supportSession;
      setAuditEvents((current) => [makeAuditEvent({
        occurredAt: "Just now",
        actor: "System",
        actorType: "system",
        businessId: expiredSession.businessId,
        action: "support.session.expire",
        resource: expiredSession.id,
        outcome: "Completed",
        supportSessionId: expiredSession.id,
        reason: "Session expired automatically",
      }), ...current]);
      setSupportSession((current) => current?.id === expiredSession.id ? null : current);
      setSupportAccessObservedAt(null);
      if (IS_DEMO_MODE) platformApi.clearSupportSession();
      else void platformApi.endSupportSession(expiredSession.id, "Support session expired automatically").catch(() => platformApi.clearSupportSession());
      setAddJobOpen(false);
      navigate(workspaceRoute("agency"));
    };
    if (remaining <= 0) {
      expire();
      return;
    }
    const timer = window.setTimeout(expire, remaining);
    return () => window.clearTimeout(timer);
  }, [supportSession]);

  useEffect(() => {
    if (supportSession?.scope !== "configuration" || !session?.stepUpVerifiedAt) return;
    const remaining = new Date(session.stepUpVerifiedAt).getTime() + 15 * 60 * 1_000 - Date.now();
    const invalidate = () => {
      if (IS_DEMO_MODE) {
        refreshPermissionClock((value) => value + 1);
        return;
      }
      setWorkspaceAccess((current) => current?.businessId === supportSession.businessId ? {
        ...current,
        canManageBusiness: false,
        canManageBilling: false,
        canManageStripeBilling: false,
      } : current);
      setAddJobOpen(false);
    };
    if (remaining <= 0) {
      invalidate();
      return;
    }
    const timer = window.setTimeout(invalidate, remaining);
    return () => window.clearTimeout(timer);
  }, [session?.stepUpVerifiedAt, supportSession?.id, supportSession?.scope]);

  useEffect(() => {
    if (IS_DEMO_MODE || !supportSession || supportAccessObservedAt === null) return;
    const remaining = supportAccessObservedAt + 15 * 60 * 1_000 - Date.now();
    const invalidate = () => {
      setWorkspaceAccess((current) => current?.businessId === supportSession.businessId ? {
        ...current,
        canReadTenant: false,
        canManageBusiness: false,
        canReadBilling: false,
        canManageBilling: false,
        canManageStripeBilling: false,
      } : current);
      setAddJobOpen(false);
    };
    if (remaining <= 0) {
      invalidate();
      return;
    }
    const timer = window.setTimeout(invalidate, remaining);
    return () => window.clearTimeout(timer);
  }, [supportAccessObservedAt, supportSession?.businessId, supportSession?.id]);

  const signIn = async (email: string, password: string) => {
    setWorkspaceError("");
    await platformApi.login(email, password);
    const authenticated = await platformApi.getSession();
    sessionRef.current = authenticated;
    setSession(authenticated);
    setWorkspaceState("loading");
    const requestedBusinessId = workspaceBusinessForSession(
      routeContext,
      authenticated.role,
      authenticated.businessId,
    );
    const requestedLocationId = workspaceLocationForBusiness(
      routeContext,
      requestedBusinessId,
      undefined,
      undefined,
    );
    try {
      const workspace = await platformApi.getWorkspace(requestedBusinessId, requestedLocationId);
      applyWorkspace(workspace);
      const signedInBusinessId = workspace.session.businessId ?? requestedBusinessId;
      const signedInBusiness = workspace.businesses.find((candidate) => candidate.id === signedInBusinessId);
      const locationId = requestedLocationId
        ?? signedInBusiness?.locationId
        ?? signedInBusiness?.locationReports?.[0]?.id;
      const signedInView = isAppViewAllowed(requestedView, workspace.session.role, false, workspace.session.businessRole)
        ? requestedView
        : defaultAppView(workspace.session.role, false, workspace.session.businessRole);
      navigate(workspaceRouteForSession(signedInView, workspace.session.businessRole, {
        businessId: signedInBusinessId,
        locationId,
      }), { replace: true });
      setWorkspaceState("authenticated");
    } catch (caught) {
      setWorkspaceError(caught instanceof Error ? caught.message : "The workspace could not be loaded.");
      setWorkspaceState("error");
    }
  };

  const signOut = async () => {
    setWorkspaceError("");
    try {
      if (supportSession && !IS_DEMO_MODE) {
        try {
          await platformApi.endSupportSession(supportSession.id, "Session ended because the agency user signed out");
        } catch {
          // Logout still revokes the authenticated session; the bounded support lease then expires server-side.
        }
      }
      await platformApi.logout();
    } finally {
      platformApi.clearSupportSession();
      sessionRef.current = null;
      setSession(null);
      setSupportSession(null);
      setSupportAccessObservedAt(null);
      setEndingSupportSession(false);
      setBusinesses([]);
      setRequestsByBusiness({});
      setReviewsByBusiness({});
      setQrCodesByBusiness({});
      setWorkflowsByLocation({});
      setWorkspaceAccess(undefined);
      setPlatformExceptions([]);
      setAuditEvents([]);
      setWorkspaceState("anonymous");
      setSidebarOpen(false);
      setAddJobOpen(false);
    }
  };

  const clearGoogleSelection = () => {
    const params = new URLSearchParams(location.search);
    const businessId = params.get("business") ?? undefined;
    const locationId = params.get("location") ?? undefined;
    navigate(workspaceRoute("settings-billing", { businessId, locationId, settingsBillingTab: "connections" }), { replace: true });
    setGoogleProfileSelection(null);
    setGoogleSelectionError("");
    setGoogleSelectionLoading(false);
    setWorkspaceNotice({ tone: "warning", message: "Google profile selection was cancelled. No connection changes were made." });
  };

  const completeGoogleSelection = async (profileIndex: number) => {
    if (!selectionToken || !googleProfileSelection) return;
    setGoogleSelectionSaving(true);
    setGoogleSelectionError("");
    try {
      await platformApi.completeGoogleProfileSelection(selectionToken, profileIndex);
      const refreshed = await platformApi.getWorkspace(googleProfileSelection.businessId, googleProfileSelection.locationId);
      applyWorkspace(refreshed);
      setGoogleProfileSelection(null);
      setGoogleSelectionLoading(false);
      setWorkspaceNotice({ tone: "success", message: "Google Business Profile was connected to this location." });
      navigate(workspaceRoute("settings-billing", { businessId: googleProfileSelection.businessId, locationId: googleProfileSelection.locationId, settingsBillingTab: "connections" }), { replace: true });
    } catch (caught) {
      setGoogleSelectionError(caught instanceof Error ? caught.message : "The Google location could not be connected.");
    } finally {
      setGoogleSelectionSaving(false);
    }
  };

  const fallbackView = defaultAppView(session?.role, Boolean(supportSession), session?.businessRole);
  const view = session && isAppViewAllowed(requestedView, session.role, Boolean(supportSession), session.businessRole)
    ? requestedView
    : fallbackView;

  useEffect(() => {
    if (workspaceState !== "authenticated" || !session) return;
    if (isAppViewAllowed(requestedView, session.role, Boolean(supportSession), session.businessRole)) return;
    const fallback = defaultAppView(session.role, Boolean(supportSession), session.businessRole);
    if (fallback === "agency") {
      navigate(defaultWorkspaceRoute(session.role, Boolean(supportSession), session.businessRole), { replace: true });
    } else {
      navigateToView(fallback, { replace: true });
    }
  }, [requestedView, session?.role, supportSession?.id, workspaceState]);

  if (workspaceState === "error" && session) {
    return (
      <main className="workspace-auth-shell">
        <button className="workspace-auth-shell__brand" type="button" onClick={() => navigate("/")} aria-label="Return to the Review Anchor website"><Brand /></button>
        <section className="workspace-auth-card">
          <span className="eyebrow">Workspace unavailable</span>
          <h1>Your session is still active.</h1>
          <p>{workspaceError || "The selected tenant context could not be loaded."}</p>
          <div className="dialog-card__actions">
            <Button variant="secondary" onClick={() => window.location.reload()}>Retry</Button>
            <Button onClick={() => navigate(defaultWorkspaceRoute(session.role, Boolean(supportSession), session.businessRole), { replace: true })}>Open default workspace</Button>
          </div>
          <small>No account or business context was changed.</small>
        </section>
      </main>
    );
  }

  if (workspaceState !== "authenticated" || !session) {
    return (
      <WorkspaceAuthScreen
        state={workspaceState === "authenticated" ? "error" : workspaceState}
        error={workspaceError}
        onLogin={signIn}
        onBack={() => navigate("/")}
      />
    );
  }

  const agencyMode = session.role === "agency_admin" && !supportSession;
  const business = businesses.find((item) => item.id === (supportSession?.businessId ?? session.businessId ?? selectedBusinessId)) ?? businesses[0];
  if (!business) {
    return (
      <main className="workspace-auth-shell">
        <button className="workspace-auth-shell__brand" type="button" onClick={() => navigate("/")} aria-label="Return to the Review Anchor website"><Brand /></button>
        <section className="workspace-auth-card">
          <span className="eyebrow">Signed-in account</span>
          <h1>{agencyMode ? "No client accounts are assigned yet." : "No business workspace is assigned yet."}</h1>
          <p>{agencyMode ? "Your agency session is active, but no authorised client summaries are available." : "Your session is active. Ask an administrator to assign this account to a business before continuing."}</p>
          <div className="workspace-auth-card__actions"><Button variant="secondary" onClick={() => navigate("/")}>View website</Button><Button onClick={() => void signOut()}>Sign out</Button></div>
        </section>
      </main>
    );
  }

  const routeLocationBelongsToBusiness = (!routeContext.businessId || routeContext.businessId === business.id)
    && Boolean(routeContext.locationId)
    && (business.locationId === routeContext.locationId
      || business.locationReports?.some((candidate) => candidate.id === routeContext.locationId));
  const selectedLocationId = routeLocationBelongsToBusiness
    ? routeContext.locationId
    : business.locationId ?? business.locationReports?.[0]?.id;
  const selectedLocation = business.locationReports?.find((location) => location.id === selectedLocationId);
  const contextBusiness = selectedLocation ? {
    ...business,
    locationId: selectedLocation.id,
    locationName: selectedLocation.name,
    locationReports: [selectedLocation],
    metrics: {
      ...business.metrics,
      completedJobs: selectedLocation.completedJobs,
      delivered: selectedLocation.delivered,
      uniqueClicks: selectedLocation.uniqueClicks,
      reviewsDetected: selectedLocation.reviewsDetected,
      rating: selectedLocation.rating,
      totalReviews: selectedLocation.totalReviews,
    },
  } : business;
  const requests = (requestsByBusiness[business.id] ?? []).filter(
    (request) => !selectedLocationId || request.locationId === selectedLocationId,
  );
  const reviews = (reviewsByBusiness[business.id] ?? []).filter(
    (review) => !selectedLocationId || review.locationId === selectedLocationId,
  );
  const selectedWorkflow = selectedLocationId
    ? workflowsByLocation[selectedLocationId]
      ?? (IS_DEMO_MODE ? seededDemoWorkflow(contextBusiness, qrCodesByBusiness[business.id]) : undefined)
    : undefined;
  const accessMatchesContext = workspaceAccess?.businessId === business.id
    && (!workspaceAccess.locationId || workspaceAccess.locationId === selectedLocationId);
  const canReadTenant = IS_DEMO_MODE
    ? canReadTenantData(session, business.id, supportSession)
    : Boolean(accessMatchesContext && workspaceAccess?.canReadTenant);
  const canConfigure = IS_DEMO_MODE
    ? canConfigureTenant(session, business.id, supportSession)
    : Boolean(accessMatchesContext && workspaceAccess?.canManageBusiness);
  const canReadTenantBilling = IS_DEMO_MODE
    ? canManageBilling(session, business.id)
    : Boolean(workspaceAccess?.businessId === business.id && workspaceAccess.canReadBilling);
  const canManageTenantBilling = IS_DEMO_MODE
    ? canManageBilling(session, business.id)
    : Boolean(workspaceAccess?.businessId === business.id && workspaceAccess.canManageBilling);
  const canManageStripeBilling = IS_DEMO_MODE
    ? canManageBilling(session, business.id)
    : Boolean(workspaceAccess?.businessId === business.id && workspaceAccess.canManageStripeBilling);
  const navItems = (agencyMode ? AGENCY_NAV : CLIENT_NAV).filter((item) => (
    isAppViewAllowed(item.id, session.role, Boolean(supportSession), session.businessRole)
  ));
  const page = [...CLIENT_NAV, ...AGENCY_NAV].find((item) => item.id === view) ?? navItems[0];
  const descriptions: Record<AppView, string> = {
    home: "Google review snapshot, request status, connection health, and reporting links.",
    "google-profile": "Google connection status, current reviews, review requests, and QR details.",
    content: "Content publishing availability and destination authorisation status.",
    reports: IS_DEMO_MODE ? "A simple monthly proof-of-value report." : "Current durable metrics and integration status for this tenant.",
    "settings-billing": "Connections, workspace settings, users, and billing.",
    agency: "Client accounts, connection health, open exceptions, and paused scopes.",
    "operations-exceptions": "Operational failures with impact and safe resolution paths.",
    "operations-audit": "Append-only evidence for administrative and support actions.",
  };

  const recordAudit = (event: Omit<AuditEvent, "id" | "correlationId">) => {
    setAuditEvents((current) => [makeAuditEvent(event), ...current]);
  };

  const endSupportSession = async () => {
    if (!supportSession || endingSupportSession) return;
    setEndingSupportSession(true);
    setWorkspaceError("");
    try {
      if (IS_DEMO_MODE) {
        recordAudit({
          occurredAt: "Just now",
          actor: session.userName,
          actorType: "user",
          businessId: supportSession.businessId,
          action: "support.session.end",
          resource: supportSession.id,
          outcome: "Completed",
          supportSessionId: supportSession.id,
          reason: "Session ended explicitly",
        });
      } else {
        await platformApi.endSupportSession(supportSession.id, "Session ended explicitly by agency user");
      }
      setSupportSession(null);
      setSupportAccessObservedAt(null);
      setAddJobOpen(false);
      navigate(workspaceRoute("agency"));
    } catch (caught) {
      setWorkspaceError(caught instanceof Error ? caught.message : "The support session could not be ended.");
    } finally {
      setEndingSupportSession(false);
    }
  };

  const exitWorkspace = async () => {
    if (supportSession) {
      if (IS_DEMO_MODE) {
        recordAudit({
          occurredAt: "Just now",
          actor: session.userName,
          actorType: "user",
          businessId: supportSession.businessId,
          action: "support.session.end",
          resource: supportSession.id,
          outcome: "Completed",
          supportSessionId: supportSession.id,
          reason: "Workspace exited",
        });
        platformApi.clearSupportSession();
      } else {
        try {
          await platformApi.endSupportSession(supportSession.id, "Workspace exited by agency user");
        } catch {
          platformApi.clearSupportSession();
        }
      }
      setSupportSession(null);
      setSupportAccessObservedAt(null);
    }
    setAddJobOpen(false);
    navigate("/");
  };

  const changeRole = (role: ActorRole) => {
    if (role === session.role && !supportSession) return;
    if (supportSession) endSupportSession();
    setSupportDialogBusiness(null);
    setAddJobOpen(false);
    if (role === "agency_admin") {
      const nextSession = { ...ADMIN_SESSION, stepUpVerifiedAt: new Date().toISOString() };
      sessionRef.current = nextSession;
      setSession(nextSession);
    } else {
      sessionRef.current = OWNER_SESSION;
      setSession(OWNER_SESSION);
      setSelectedBusinessId(OWNER_SESSION.businessId ?? BUSINESSES[0].id);
    }
  };

  const beginSupportSession = async (input: { scope: SupportScope; reason: string; durationMinutes: 15 | 30 }) => {
    if (!supportDialogBusiness) return;
    if (!IS_DEMO_MODE) {
      const target = supportDialogBusiness;
      const startedAt = new Date();
      const remote = await platformApi.startSupportSession({ businessId: target.id, ...input });
      const created: SupportSession = {
        id: remote.id,
        actorUserId: session.userId,
        actorName: session.userName,
        businessId: target.id,
        reason: input.reason,
        scope: remote.scope,
        startedAt: startedAt.toISOString(),
        expiresAt: remote.expiresAt,
      };
      setSupportSession(created);
      try {
        const refreshed = await platformApi.getWorkspace(target.id, target.locationId);
        applyWorkspace(refreshed);
        setSelectedBusinessId(target.id);
        setSupportDialogBusiness(null);
        const refreshedBusiness = refreshed.businesses.find((candidate) => candidate.id === target.id);
        const refreshedLocationId = refreshedBusiness?.locationId ?? refreshedBusiness?.locationReports?.[0]?.id;
    navigateToView("home", { businessId: target.id, locationId: refreshedLocationId });
      } catch (caught) {
        setSupportSession(null);
        try {
          await platformApi.endSupportSession(created.id, "Support workspace failed to load");
        } catch {
          platformApi.clearSupportSession();
        }
        throw caught;
      }
      return;
    }
    const startedAt = new Date();
    const created = startSupportSession(session, {
      businessId: supportDialogBusiness.id,
      reason: input.reason,
      scope: input.scope,
      durationMinutes: input.durationMinutes,
    }, startedAt);
    recordAudit({
      occurredAt: "Just now",
      actor: session.userName,
      actorType: "user",
      businessId: supportDialogBusiness.id,
      action: "support.session.start",
      resource: created.id,
      outcome: "Allowed",
      supportSessionId: created.id,
      reason: created.reason,
    });
    setSupportSession(created);
    setSelectedBusinessId(supportDialogBusiness.id);
    setSupportDialogBusiness(null);
    navigateToView("home", { businessId: supportDialogBusiness.id, locationId: supportDialogBusiness.locationId });
  };

  const saveSmsOveragePolicy = async (policy: SmsOveragePolicy) => {
    if (!canManageTenantBilling) throw new Error("You do not have permission to change SMS billing controls.");
    if (IS_DEMO_MODE) {
      setBusinesses((current) => current.map((item) => item.id === business.id && item.billing
        ? { ...item, billing: { ...item.billing, smsOveragePolicy: policy } }
        : item));
      return;
    }
    await platformApi.updateSmsOveragePolicy(business.id, policy);
    const refreshed = await platformApi.getWorkspace(business.id, selectedLocationId);
    applyWorkspace(refreshed);
  };

  const startStripeCheckout = async () => {
    if (!canManageStripeBilling) throw new Error("Stripe billing changes require a direct owner, administrator or billing-role session.");
    if (IS_DEMO_MODE) throw new Error("Stripe Checkout is disabled in the seeded demo.");
    const attemptId = stripeCheckoutAttempts.current.get(business.id) ?? crypto.randomUUID();
    stripeCheckoutAttempts.current.set(business.id, attemptId);
    const checkoutUrl = await platformApi.startStripeCheckout(business.id, selectedLocationId, attemptId);
    window.location.assign(checkoutUrl);
  };

  const openStripeBillingPortal = async () => {
    if (!canManageStripeBilling) throw new Error("Stripe billing changes require a direct owner, administrator or billing-role session.");
    if (IS_DEMO_MODE) throw new Error("The Stripe billing portal is disabled in the seeded demo.");
    const portalUrl = await platformApi.openStripeBillingPortal(business.id, selectedLocationId);
    window.location.assign(portalUrl);
  };

  const addRequest = async (draft: CompletedJobDraft) => {
    if (!canConfigure) throw new Error("You do not have permission to add a completed job.");
    if (!IS_DEMO_MODE) {
      await platformApi.createCompletedJob(business.id, draft);
      const refreshed = await platformApi.getWorkspace(business.id, draft.locationId);
      applyWorkspace(refreshed);
      navigateToView("google-profile", { businessId: business.id, locationId: draft.locationId, googleProfileTab: "requests-qr" });
      return;
    }

    const phoneDigits = draft.phone?.replace(/\D/g, "") ?? "";
    const request: RequestRecord = {
      id: `REQ-${1049 + Math.floor(Math.random() * 200)}`,
      businessId: business.id,
      locationId: draft.locationId,
      customer: `${draft.firstName} ${draft.lastName ?? ""}`.trim(),
      job: draft.serviceLabel,
      channel: draft.preferredChannel,
      destination: draft.preferredChannel === "SMS" ? `•••• ${phoneDigits.slice(-4)}` : (draft.email ?? "").replace(/^(.).+(@.+)$/, "$1•••$2"),
      status: draft.consent.status === "granted" ? "Queued" : "Blocked",
      createdAt: "Just now",
      consentBasis: draft.consent.source,
      consentStatus: draft.consent.status === "granted" ? "Verified" : draft.consent.status === "withdrawn" ? "Withdrawn" : "Missing",
      consentReference: draft.consent.status === "granted" ? draft.consent.transactionReference : "Not supplied",
      consentCapturedAt: draft.consent.status === "granted" ? draft.consent.capturedAt : "Not supplied",
      consentWordingVersion: draft.consent.status === "granted" ? draft.consent.wordingVersion : "Not supplied",
    };
    setRequestsByBusiness((current) => ({ ...current, [business.id]: [request, ...(current[business.id] ?? [])] }));
    recordAudit({
      occurredAt: "Just now",
      actor: session.userName,
      actorType: "user",
      businessId: business.id,
      action: request.status === "Blocked" ? "campaign.enrolment.blocked" : "completed_job.create",
      resource: request.id,
      outcome: request.status === "Blocked" ? "Blocked" : "Completed",
      supportSessionId: supportSession?.id,
      reason: request.status === "Blocked" ? "Required consent evidence missing" : `${request.consentBasis} · ${request.consentReference}`,
    });
    navigateToView("google-profile", { businessId: business.id, locationId: draft.locationId, googleProfileTab: "requests-qr" });
  };

  const beginGoogleConnection = async () => {
    setWorkspaceError("");
    if (IS_DEMO_MODE) {
      setWorkspaceError("Google connection is available after signing in to a configured production workspace.");
      return;
    }
    if (!selectedLocationId) {
      setWorkspaceError("This workspace has no active location identifier. Refresh the workspace after the backend migration is applied.");
      return;
    }
    if (supportSession) {
      setWorkspaceError("Google Business Profile must be connected by a directly signed-in business owner or administrator.");
      return;
    }
    try {
      const authorizationUrl = await platformApi.startGoogleOAuth(business.id, selectedLocationId);
      window.location.assign(authorizationUrl);
    } catch (caught) {
      setWorkspaceError(caught instanceof Error ? caught.message : "Google authorization could not be started.");
    }
  };

  const googleConnectAvailable = !IS_DEMO_MODE
    && !supportSession
    && !servicesLoading
    && (services.find((service) => service.key === "google")?.configured ?? false);
  const stripeCheckoutEnabled = !IS_DEMO_MODE
    && !servicesLoading
    && (services.find((service) => service.key === "stripeCheckout")?.configured ?? false);
  const stripePortalEnabled = !IS_DEMO_MODE
    && !servicesLoading
    && (services.find((service) => service.key === "stripeBillingPortal")?.configured ?? false);
  const supportAvailable = IS_DEMO_MODE || session.mfaVerified;

  const headerActions = agencyMode
    ? undefined
    : view === "home" && canConfigure
      ? <Button onClick={() => setAddJobOpen(true)}><Plus size={16} /> Add job</Button>
      : view === "settings-billing" && settingsBillingTab === "connections" && !IS_DEMO_MODE
        ? <Button disabled={!canConfigure || !googleConnectAvailable} onClick={() => void beginGoogleConnection()}><Link2 size={16} /> {supportSession ? "Owner sign-in required" : googleConnectAvailable ? "Connect Google" : "Google unavailable"}</Button>
        : undefined;

  const supportBanner = supportSession ? (
    <SupportSessionBanner supportSession={supportSession} business={business} actor={session.userName} onEnd={endSupportSession} ending={endingSupportSession} />
  ) : undefined;

  return (
    <div className="app-shell">
      <AppSidebar
        view={view}
        onView={navigateToView}
        onBack={() => void exitWorkspace()}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        navItems={navItems}
        business={contextBusiness}
        session={session}
        supportSession={supportSession}
        onRoleChange={changeRole}
        businessCount={businesses.length}
        exceptionCount={platformExceptions.length}
        demoMode={IS_DEMO_MODE}
        onLogout={() => void signOut()}
        compactViewport={compactViewport}
      />
      {sidebarOpen && <button type="button" className="sidebar-scrim" aria-label="Close workspace navigation" onClick={() => setSidebarOpen(false)} />}
      <main className={cx("app-main", supportSession && "app-main--support")}>
        <PageHeader title={page.label} description={descriptions[view]} onMenu={() => setSidebarOpen(true)} navigationOpen={sidebarOpen} actions={headerActions} banner={supportBanner} />
        <div className="app-content">
          {workspaceNotice && <div className={cx("workspace-inline-notice", `workspace-inline-notice--${workspaceNotice.tone}`)} role={workspaceNotice.tone === "error" ? "alert" : "status"}><span>{workspaceNotice.message}</span><button type="button" onClick={() => setWorkspaceNotice(null)} aria-label="Dismiss notification"><X size={16} /></button></div>}
          {workspaceError && <div className="workspace-inline-error" role="alert"><AlertTriangle size={17} /><span>{workspaceError}</span><button type="button" onClick={() => setWorkspaceError("")} aria-label="Dismiss message"><X size={16} /></button></div>}
          {servicesError && view === "settings-billing" && <div className="workspace-inline-error" role="alert"><AlertTriangle size={17} /><span>{servicesError}</span><button type="button" onClick={() => setServicesVersion((value) => value + 1)}>Retry status</button></div>}
          {agencyMode && view === "agency" && <AgencyView agencyId={session.agencyId} canRevoke={session.agencyRole === "owner" || session.agencyRole === "admin"}><AgencyOverviewView businesses={businesses} exceptions={platformExceptions} onView={(nextView) => navigateToView(nextView === "exceptions" ? "operations-exceptions" : nextView === "audit" ? "operations-audit" : "agency")} onStartSupport={setSupportDialogBusiness} supportAvailable={supportAvailable} /><ClientsView businesses={businesses} onStartSupport={setSupportDialogBusiness} supportAvailable={supportAvailable} /><details className="panel"><summary>Secondary operations</summary><div className="dialog-card__actions"><Button variant="secondary" onClick={() => navigateToView("operations-exceptions")}>Exceptions</Button><Button variant="secondary" onClick={() => navigateToView("operations-audit")}>Audit log</Button></div></details></AgencyView>}
          {agencyMode && view === "operations-exceptions" && <ExceptionsView businesses={businesses} exceptions={platformExceptions} onStartSupport={setSupportDialogBusiness} supportAvailable={supportAvailable} />}
          {agencyMode && view === "operations-audit" && <AuditLogView businesses={businesses} events={auditEvents} />}
          {!agencyMode && !canReadTenant && view !== "settings-billing" && <section className="panel access-expired"><ShieldCheck size={26} /><h2>Tenant access is unavailable.</h2><p>{supportSession ? "Support access expired or no longer satisfies the required security evidence." : "Your business role does not include customer or location data."}</p>{supportSession && <Button onClick={endSupportSession}>Return to portfolio</Button>}</section>}
          {!agencyMode && view === "settings-billing" && settingsBillingTab === "billing" && !canReadTenantBilling && <section className="panel access-expired"><ShieldCheck size={26} /><h2>Billing access is unavailable.</h2><p>{supportSession ? "Support sessions cannot open or change tenant billing." : "Your signed-in business role does not include billing access."}</p>{supportSession && <Button onClick={endSupportSession}>Return to portfolio</Button>}</section>}
          {!agencyMode && canReadTenant && view === "google-profile" && <><WorkspaceContextBar business={business} locationId={selectedLocationId} onSelectLocation={(locationId) => navigateToView("google-profile", { businessId: business.id, locationId, googleProfileTab })} /><GoogleProfileView tab={googleProfileTab} onTabChange={(tab) => navigateToView("google-profile", { googleProfileTab: tab })}>{googleProfileTab === "reviews" ? <ReviewsView business={contextBusiness} reviews={reviews} /> : googleProfileTab === "requests-qr" ? <><RequestsView requests={requests} onAddJob={() => setAddJobOpen(true)} canConfigure={canConfigure} /><AutomationView business={contextBusiness} requests={requests} workflow={selectedWorkflow} onOpenIntegrations={() => navigateToView("settings-billing", { settingsBillingTab: "connections" })} />{qrCodesByBusiness[business.id]?.locationId === selectedLocationId ? <QrCodesView business={contextBusiness} record={qrCodesByBusiness[business.id]} /> : <section className="panel empty-state"><QrCode size={24} /><h2>No QR code for this location.</h2><p>Connect a verified Google review destination before generating location-specific artwork.</p><Button onClick={() => navigateToView("settings-billing", { settingsBillingTab: "connections" })}>Open connections</Button></section>}</> : googleProfileTab === "profile" ? <IntegrationsView business={contextBusiness} onConnect={() => void beginGoogleConnection()} canConfigure={canConfigure && !supportSession} services={services} servicesLoading={servicesLoading} /> : <section className="panel empty-state"><h2>Posts and media are not enabled for this workspace.</h2><p>No publishing capability is presented until its connected destination is authorised.</p></section>}</GoogleProfileView></>}
          {!agencyMode && canReadTenant && view === "content" && <><WorkspaceContextBar business={business} locationId={selectedLocationId} onSelectLocation={(locationId) => navigateToView("content", { businessId: business.id, locationId, contentTab })} /><ContentView tab={contentTab} onTabChange={(tab) => navigateToView("content", { contentTab: tab })} /></>}
          {!agencyMode && canReadTenant && view === "reports" && <ProductReportsView><ReportsView business={business} selectedBusiness={contextBusiness} /></ProductReportsView>}
          {!agencyMode && view === "settings-billing" && <SettingsBillingView tab={settingsBillingTab} canAccessConnections={session.businessRole !== "billing" && canReadTenant} onTabChange={(tab) => navigateToView("settings-billing", { settingsBillingTab: tab })}>{settingsBillingTab === "connections" && canReadTenant ? <IntegrationsView business={contextBusiness} onConnect={() => void beginGoogleConnection()} canConfigure={canConfigure && !supportSession} services={services} servicesLoading={servicesLoading} /> : settingsBillingTab === "billing" && canReadTenantBilling ? <TeamBillingView business={business} canConfigure={canManageTenantBilling} canManageStripe={canManageStripeBilling} canViewTeamMembers={canConfigure} onSaveSmsPolicy={saveSmsOveragePolicy} onStartCheckout={startStripeCheckout} onOpenBillingPortal={openStripeBillingPortal} stripeCheckoutEnabled={stripeCheckoutEnabled} stripePortalEnabled={stripePortalEnabled} /> : null}</SettingsBillingView>}
          {!agencyMode && canReadTenant && view === "home" && <HomeView><GrowthSuite
            business={business}
            businesses={businesses}
            requests={requests}
            reviews={reviews}
            session={session}
            agencyMode={agencyMode}
            canConfigure={canConfigure}
            canManageBilling={canManageTenantBilling}
            selectedLocationId={selectedLocationId}
            onSelectLocation={(locationId) => navigateToView("home", { businessId: business.id, locationId })}
            onNavigate={navigateToView}
            onAddJob={() => setAddJobOpen(true)}
          /></HomeView>}
        </div>
      </main>
      <AddJobDialog open={addJobOpen && canConfigure} onClose={() => setAddJobOpen(false)} onAdd={addRequest} locationId={selectedLocationId} demoMode={IS_DEMO_MODE} />
      <SupportSessionDialog business={supportDialogBusiness} session={session} onClose={() => setSupportDialogBusiness(null)} onStart={beginSupportSession} />
      {selectionToken && <GoogleProfileSelectionDialog
        selection={googleProfileSelection}
        loading={googleSelectionLoading}
        error={googleSelectionError}
        saving={googleSelectionSaving}
        onConfirm={(profileIndex) => void completeGoogleSelection(profileIndex)}
        onClose={clearGoogleSelection}
      />}
    </div>
  );
}

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const returnParams = new URLSearchParams(location.search);
  const oauthReturn = !IS_DEMO_MODE && returnParams.has("google");
  const billingReturn = !IS_DEMO_MODE && (returnParams.has("checkout") || returnParams.has("billing"));
  const publicToken = location.pathname.match(/^\/r\/([a-z0-9-]+)\/?$/i)?.[1];
  const publicQrCode = IS_DEMO_MODE && publicToken ? getQrCodeByToken(publicToken) : undefined;

  if (!IS_DEMO_MODE && location.pathname === "/app/agency-grant") {
    const claim = returnParams.get("claim") ?? "";
    return <ThemeProvider><main className="workspace-auth-shell"><section className="workspace-auth-card"><span className="eyebrow">Client approval</span><h1>Choose an approved location</h1><p>Only locations you directly own or administer are shown.</p><ClientLocationSelector claimToken={claim} onSelect={() => navigate("/app", { replace: true })} /></section></main></ThemeProvider>;
  }

  if (!IS_DEMO_MODE && location.pathname === "/signup") return <ThemeProvider><SignupView onSubmitted={(email) => navigate(`/signup/check-email?email=${encodeURIComponent(email)}`)} /></ThemeProvider>;
  if (!IS_DEMO_MODE && location.pathname === "/signup/check-email") return <ThemeProvider><CheckEmailView email={returnParams.get("email")} /></ThemeProvider>;
  if (!IS_DEMO_MODE && location.pathname === "/signup/verify") return <ThemeProvider><VerifyEmailView token={returnParams.get("token")} onVerified={(accountType) => navigate(accountType === "business" ? "/signup/business" : "/signup/agency", { replace: true })} /></ThemeProvider>;
  if (!IS_DEMO_MODE && location.pathname === "/signup/business") return <ThemeProvider><BusinessOnboarding onComplete={(result) => navigate(result.businessId ? `/app/settings-billing/connections?businessId=${encodeURIComponent(result.businessId)}&locationId=${encodeURIComponent(result.locationId ?? "")}` : "/app")} /></ThemeProvider>;
  if (!IS_DEMO_MODE && location.pathname === "/signup/agency") return <ThemeProvider><AgencyOnboarding onComplete={() => navigate("/app", { replace: true })} /></ThemeProvider>;

  const startSetup = () => {
    navigate(workspaceRoute("home"));
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  if (publicQrCode) return <ThemeProvider><PublicReviewFlow business={getBusiness(publicQrCode.businessId)} record={publicQrCode} /></ThemeProvider>;
  if (!IS_DEMO_MODE && publicToken) return <ThemeProvider><LivePublicReviewFlow publicToken={publicToken} /></ThemeProvider>;
  if (location.pathname === "/" && (oauthReturn || billingReturn)) {
    const target = oauthReturn ? "/app/settings-billing/connections" : "/app/settings-billing/billing";
    return <Navigate to={`${target}${location.search}`} replace />;
  }
  if (location.pathname === "/") {
    return <ThemeProvider><MarketingSite onOpenDemo={() => navigate(workspaceRoute("home"))} onStartSetup={startSetup} /></ThemeProvider>;
  }
  const matchedRoute = parseWorkspaceRoute(location.pathname, location.search);
  if (matchedRoute?.legacy) return <ThemeProvider><LegacyRouteRedirect pathname={location.pathname} search={location.search} /></ThemeProvider>;
  const matchedAppView = matchedRoute?.view;
  const lowerPathname = location.pathname.toLowerCase();
  if (lowerPathname.startsWith("/app") && !matchedAppView) {
    return (
      <ThemeProvider>
        <main className="workspace-auth-shell">
          <button className="workspace-auth-shell__brand" type="button" onClick={() => navigate("/")}><Brand /></button>
          <section className="workspace-auth-card">
            <span className="eyebrow">Page not found</span>
            <h1>This product route does not exist.</h1>
            <p>Open the connected workspace to continue in the same account.</p>
            <Button onClick={() => navigate(workspaceRoute("home"))}>Open Home</Button>
          </section>
        </main>
      </ThemeProvider>
    );
  }
  if (!lowerPathname.startsWith("/app")) return <Navigate to="/" replace />;

  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  );
}
