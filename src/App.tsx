import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  ClipboardCheck,
  Clock3,
  ExternalLink,
  FileText,
  Gauge,
  Link2,
  ListFilter,
  Mail,
  MapPin,
  Menu,
  MessageSquareText,
  PauseCircle,
  Plug,
  Plus,
  Printer,
  QrCode,
  Search,
  Send,
  ShieldCheck,
  Smartphone,
  Star,
  UsersRound,
  Webhook,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  AgencyOverviewView,
  AuditLogView,
  ClientsView,
  ExceptionsView,
  TeamBillingView,
} from "./platform/AgencyViews";
import { PublicReviewFlow, QrCodesView } from "./platform/QrCodesView";
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
  canReadTenantData,
  getBusiness,
  getQrCodeByToken,
  makeAuditEvent,
  startSupportSession,
  validateNeutralReviewTemplate,
  type ActorRole,
  type AuditEvent,
  type BusinessAccount,
  type Channel,
  type ConsentStatus,
  type RequestRecord,
  type RequestStatus,
  type ReviewRecord,
  type QrCodeRecord,
  type SessionContext,
  type SupportScope,
  type SupportSession,
  type WorkspaceView,
} from "./platform/domain";

type Surface = "site" | "app";
type AppView = WorkspaceView;

interface StoryStep {
  title: string;
  copy: string;
  detail: string;
  icon: LucideIcon;
}

const DEFAULT_TEMPLATE =
  "Hi {{first_name}}, thanks for choosing {{business_name}}. If you have 30 seconds, we’d appreciate an honest Google review: {{review_link}}. Reply STOP to opt out.";

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

const CLIENT_NAV: Array<{ id: AppView; label: string; icon: LucideIcon }> = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "requests", label: "Requests", icon: UsersRound },
  { id: "automation", label: "Automation", icon: Activity },
  { id: "reviews", label: "Reviews", icon: Star },
  { id: "qr-codes", label: "QR codes", icon: QrCode },
  { id: "reports", label: "Reports", icon: FileText },
  { id: "integrations", label: "Integrations", icon: Plug },
  { id: "team-billing", label: "Team & billing", icon: Building2 },
];

const AGENCY_NAV: Array<{ id: AppView; label: string; icon: LucideIcon }> = [
  { id: "agency-overview", label: "Portfolio", icon: Gauge },
  { id: "clients", label: "Clients", icon: Building2 },
  { id: "exceptions", label: "Exceptions", icon: AlertTriangle },
  { id: "audit", label: "Audit log", icon: ClipboardCheck },
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

function LogoMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 36 36" role="img" aria-label="Afterword mark">
      <path d="M7 10.5A3.5 3.5 0 0 1 10.5 7h15A3.5 3.5 0 0 1 29 10.5v9a3.5 3.5 0 0 1-3.5 3.5H17l-6.5 5v-5A3.5 3.5 0 0 1 7 19.5v-9Z" />
      <path d="M12 13h12M12 17h8" />
    </svg>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className={cx("brand", compact && "brand--compact")}>
      <LogoMark />
      <span className="brand__name">Afterword</span>
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

function MarketingNav({ onOpenDemo, onStartSetup }: { onOpenDemo: () => void; onStartSetup: () => void }) {
  const floating = useFloatingNav();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className={cx("marketing-nav", floating && "is-floating", menuOpen && "is-menu-open")}>
      <div className="marketing-nav__inner">
        <a href="#top" className="marketing-nav__brand" aria-label="Afterword home" onClick={() => setMenuOpen(false)}>
          <Brand />
        </a>
        <nav className="marketing-nav__links" aria-label="Main navigation">
          <a href="#workflow" onClick={() => setMenuOpen(false)}>Workflow</a>
          <a href="#control" onClick={() => setMenuOpen(false)}>Control</a>
          <a href="#pricing" onClick={() => setMenuOpen(false)}>Pricing</a>
          <button type="button" className="nav-demo-link" onClick={onOpenDemo}>Open demo</button>
        </nav>
        <Button variant="primary" className="marketing-nav__cta" onClick={onStartSetup}>
          Connect Google
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
            <div className="journey-message-preview">
              <p>Hi Amelia, thanks for choosing Harbour &amp; Hearth. If you have 30 seconds, we’d appreciate an honest Google review.</p>
              <span>Review on Google <ExternalLink size={13} /></span>
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

function MarketingSite({ onOpenDemo, onStartSetup }: { onOpenDemo: () => void; onStartSetup: () => void }) {
  const [activeStoryStep, setActiveStoryStep] = useState(0);
  const stepRefs = useRef<Array<HTMLElement | null>>([]);

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
      <MarketingNav onOpenDemo={onOpenDemo} onStartSetup={onStartSetup} />
      <main>
        <section className="hero-section" aria-labelledby="hero-title">
          <div className="hero-copy reveal-sequence">
            <p className="hero-kicker"><span className="live-dot" /> Google review automation for genuine customers</p>
            <h1 id="hero-title">Every completed job can become public proof.</h1>
            <p className="hero-lede">Connect your Google Business Profile. Afterword asks every genuine customer, follows up politely and shows you what changed.</p>
            <div className="hero-actions">
              <Button onClick={onStartSetup}>Connect Google profile <ArrowRight size={17} aria-hidden="true" /></Button>
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
          <div><strong>1</strong><span>location per Starter workspace</span></div>
          <div><strong>3</strong><span>messages maximum per completed job</span></div>
          <div><strong>0</strong><span>sentiment gates or positive-only routes</span></div>
          <p>Set it once. Watch the exceptions.</p>
        </section>

        <section className="workflow-section" id="workflow" aria-labelledby="workflow-title">
          <header className="section-heading">
            <h2 id="workflow-title">One honest line from finished work to Google.</h2>
            <p>The screenshots show the right ingredients—merge fields, delays and follow-ups. Afterword removes the sprawling workflow builder and keeps the part a local business actually needs.</p>
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

        <section className="control-section" id="control" aria-labelledby="control-title">
          <div className="control-copy">
            <span className="plain-label">A quiet control room</span>
            <h2 id="control-title">See the outcome. Touch only the exceptions.</h2>
            <p>Delivery failures, opt-outs and broken integrations come to the top. Everything healthy stays out of the way.</p>
            <ul className="check-list">
              <li><Check size={17} /> Completed-job trigger health</li>
              <li><Check size={17} /> Delivery, click and opt-out events</li>
              <li><Check size={17} /> New Google reviews and rating movement</li>
              <li><Check size={17} /> Monthly client report, ready to print</li>
            </ul>
            <Button variant="secondary" onClick={onOpenDemo}>Open the demo workspace <ArrowRight size={17} /></Button>
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
          </div>
        </section>

        <section className="pricing-section" id="pricing" aria-labelledby="pricing-title">
          <header className="section-heading section-heading--compact">
            <h2 id="pricing-title">Priced for the result, not the setup time.</h2>
            <p>Messaging usage is billed separately and shown before activation.</p>
          </header>
          <div className="pricing-ledger">
            <article className="pricing-row">
              <div><span>Starter</span><strong>$297<small>/month</small></strong></div>
              <p>One location with a focused request sequence and a clear monthly report.</p>
              <ul><li>SMS or email</li><li>Up to 3 touches</li><li>Basic reporting</li></ul>
              <Button variant="secondary" onClick={onStartSetup}>Choose Starter</Button>
            </article>
            <article className="pricing-row pricing-row--featured">
              <div><span>Professional <em>Recommended</em></span><strong>$397<small>/month</small></strong></div>
              <p>SMS and email, monitored Google reviews and branded reporting.</p>
              <ul><li>Advanced sequences</li><li>Review monitoring</li><li>Additional integrations</li></ul>
              <Button onClick={onStartSetup}>Choose Professional</Button>
            </article>
            <article className="pricing-row">
              <div><span>Multi-location</span><strong>From $497<small>/month</small></strong></div>
              <p>Central control with location-level health and reporting.</p>
              <ul><li>Multiple locations</li><li>Central dashboard</li><li>Priority support</li></ul>
              <Button variant="secondary" onClick={onStartSetup}>Start multi-location</Button>
            </article>
          </div>
        </section>

        <section className="faq-section" aria-labelledby="faq-title">
          <h2 id="faq-title">The practical questions.</h2>
          <div className="faq-list">
            <details><summary>Does Afterword move or copy our Google profile?<ChevronDown size={18} /></summary><p>No. Your Business Profile stays on Google. Afterword connects with owner permission, links genuine customers to Google and monitors review data that Google makes available.</p></details>
            <details><summary>Can we send only to customers who say they are happy?<ChevronDown size={18} /></summary><p>No. That is review gating. Eligible genuine customers receive the same neutral route regardless of expected sentiment.</p></details>
            <details><summary>How many follow-ups can go out?<ChevronDown size={18} /></summary><p>The hard product limit is three total messages per completed job. Most sequences should use fewer.</p></details>
            <details><summary>Is the Google connection in this prototype live?<ChevronDown size={18} /></summary><p>No. The demo is intentionally simulated. A production connection needs approved OAuth credentials, secure token storage and Business Profile API access.</p></details>
          </div>
        </section>
      </main>

      <footer className="statement-footer">
        <p>Give every completed job an honest afterword.</p>
        <div><Brand compact /><span>Google-first review automation · Demo build</span><span>© 2026</span></div>
      </footer>

      {activeStoryStep >= 2 && (
        <aside className="sticky-cta is-visible">
          <span><strong>Ready to see it working?</strong><small>Open the seeded demo—no account needed.</small></span>
          <Button onClick={onOpenDemo}>Open demo <ArrowRight size={16} /></Button>
        </aside>
      )}
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
  compactViewport: boolean;
}) {
  const sidebarRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const agencyMode = session.role === "agency_admin" && !supportSession;
  const healthNeedsAttention = agencyMode || business.healthTone !== "success";
  const workspaceName = agencyMode ? "Afterword Agency" : business.name;
  const workspaceDetail = agencyMode
    ? `${BUSINESSES.length} client accounts · Demo`
    : supportSession
      ? `Audited ${supportSession.scope === "configuration" ? "configuration" : "view-only"} support`
      : `${business.locationName} · Demo`;

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
        <button type="button" onClick={onBack} aria-label="Return to the Afterword website"><Brand /></button>
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
        <span>{healthNeedsAttention ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}<strong>{agencyMode ? `${PLATFORM_EXCEPTIONS.length} open exceptions` : business.health}</strong></span>
        <small>{agencyMode ? "Across the managed portfolio" : business.lastSuccess}</small>
      </div>
      <label className="role-preview">
        <span>Demo role preview</span>
        <select value={session.role} onChange={(event) => onRoleChange(event.target.value as ActorRole)}>
          <option value="business_owner">Business owner</option>
          <option value="agency_admin">Agency admin</option>
        </select>
        <small>Switches the seeded interface only.</small>
      </label>
      <div className="app-sidebar__meta"><span>{supportSession ? "Support access recorded" : "Demo workspace"}</span><button type="button" onClick={onBack}>View website</button></div>
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
  return (
    <div className="demo-notice">
      <span className="demo-label">Sample data</span>
      <p>This workspace is interactive but simulated. No Google account is connected and no message will be sent.</p>
    </div>
  );
}

function MetricCard({ label, value, detail, tone, wide }: { label: string; value: string; detail: string; tone?: string; wide?: boolean }) {
  return (
    <article className={cx("metric-card", wide && "metric-card--wide", tone && `metric-card--${tone}`)}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function OverviewView({ business, requests, reviews, onAddJob, onView, canConfigure, paused }: { business: BusinessAccount; requests: RequestRecord[]; reviews: ReviewRecord[]; onAddJob: () => void; onView: (view: AppView) => void; canConfigure: boolean; paused: boolean }) {
  const addedCount = requests.length - business.seedRequestCount;
  const metrics = business.metrics;
  const latestReview = reviews[0];
  const chartPoints = "8,86 40,74 72,77 104,58 136,63 168,42 200,47 232,29 264,34 296,18";
  return (
    <div className="view-stack">
      <DemoNotice />
      <section className="metric-grid" aria-label="Sample performance metrics">
        <MetricCard label="Automation" value={paused ? "Paused" : business.automationState} detail={`Last successful trigger · ${business.lastSuccess}`} tone={paused ? "warning" : business.healthTone} wide />
        <MetricCard label="Completed jobs" value={String(metrics.completedJobs + addedCount)} detail={`${addedCount > 0 ? `+${addedCount} this session · ` : ""}July sample`} />
        <MetricCard label="Reviews detected" value={String(metrics.reviewsDetected)} detail="Google sync · this month" />
        <MetricCard label="Current rating" value={metrics.rating.toFixed(1)} detail={`${metrics.totalReviews} total Google reviews`} />
      </section>
      <section className="dashboard-grid">
        <article className="panel performance-panel">
          <header className="panel__head"><div><h2>Review activity</h2><p>New Google reviews detected · sample trend</p></div><span className="period-button" aria-label="Fixed sample period: 1 to 31 July"><CalendarDays size={16} /> 1–31 Jul</span></header>
          <div className="chart-summary"><span><strong>{metrics.reviewsDetected}</strong> new reviews</span><span><strong>{metrics.rating.toFixed(1)}</strong> current rating</span></div>
          <svg className="line-chart" viewBox="0 0 304 104" role="img" aria-label="Sample review activity trend">
            <line x1="8" y1="96" x2="296" y2="96" />
            <line x1="8" y1="56" x2="296" y2="56" />
            <polyline points={chartPoints} />
            {chartPoints.split(" ").map((point) => {
              const [cxValue, cyValue] = point.split(",");
              return <circle key={point} cx={cxValue} cy={cyValue} r="3.5" />;
            })}
          </svg>
          <p className="chart-note"><AlertTriangle size={15} /> Reviews detected are not matched to a specific customer job. Conversion is shown as an estimate.</p>
        </article>
        <article className="panel funnel-panel">
          <header className="panel__head"><div><h2>Request funnel</h2><p>July sample</p></div><button className="text-action" type="button" onClick={() => onView("requests")}>View requests <ArrowRight size={15} /></button></header>
          <div className="funnel-list">
            {[
              ["Completed jobs", metrics.completedJobs + addedCount, 100],
              ["Eligible customers", metrics.eligibleCustomers + addedCount, 94],
              ["Delivered", metrics.delivered, 85],
              ["Unique clicks", metrics.uniqueClicks, 36],
              ["Reviews detected", metrics.reviewsDetected, 24],
            ].map(([label, value, width]) => (
              <div className="funnel-row" key={label as string}>
                <div><span>{label}</span><strong>{value}</strong></div>
                <span className="funnel-track"><span style={{ "--value": `${width}%` } as CSSProperties} /></span>
              </div>
            ))}
          </div>
        </article>
        <article className="panel recent-requests-panel">
          <header className="panel__head"><div><h2>Recent requests</h2><p>Latest completed jobs</p></div><Button variant="secondary" onClick={onAddJob} disabled={!canConfigure}><Plus size={16} /> Add job</Button></header>
          <div className="compact-list">
            {requests.slice(0, 4).map((request) => (
              <div key={request.id} className="compact-row">
                <span className="compact-row__avatar">{request.customer.split(" ").map((part) => part[0]).join("")}</span>
                <span><strong>{request.customer}</strong><small>{request.job} · {request.createdAt}</small></span>
                <StatusPill tone={STATUS_TONES[request.status]}>{request.status}</StatusPill>
              </div>
            ))}
          </div>
        </article>
        <article className="panel reviews-panel">
          <header className="panel__head"><div><h2>Latest Google review</h2><p>Detected today · sample</p></div><button className="text-action" type="button" onClick={() => onView("reviews")}>View all <ArrowRight size={15} /></button></header>
          {latestReview ? <div className="featured-review"><Stars rating={latestReview.rating} size={17} /><blockquote>“{latestReview.body}”</blockquote><span>{latestReview.name} · {latestReview.date}</span></div> : <div className="empty-state"><Star size={22} /><h2>No reviews detected yet.</h2><p>New Google reviews will appear after the next successful sync.</p></div>}
        </article>
      </section>
    </div>
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
          <Button onClick={onAddJob} disabled={!canConfigure}><Plus size={16} /> Add completed job</Button>
        </header>
        {filtered.length > 0 ? (
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

const AUTOMATION_NODES = [
  { id: "trigger", label: "Job completed", description: "Webhook or manual entry", icon: Webhook },
  { id: "request", label: "Send review request", description: "SMS · neutral template", icon: MessageSquareText },
  { id: "wait", label: "Wait 48 hours", description: "Cancel on reply, review or opt-out", icon: Clock3 },
  { id: "followup", label: "Polite follow-up", description: "SMS · final touch", icon: Send },
  { id: "end", label: "End sequence", description: "Maximum 2 messages", icon: CheckCircle2 },
];

function AutomationView({ business, requests, canConfigure, paused, onStateChange, onSave }: { business: BusinessAccount; requests: RequestRecord[]; canConfigure: boolean; paused: boolean; onStateChange: (live: boolean) => void; onSave: () => void }) {
  const [selected, setSelected] = useState("request");
  const [message, setMessage] = useState(DEFAULT_TEMPLATE);
  const [waitHours, setWaitHours] = useState(48);
  const [live, setLive] = useState(!paused);
  const [saveState, setSaveState] = useState<"idle" | "loading" | "success">("idle");
  const selectedNode = AUTOMATION_NODES.find((node) => node.id === selected)!;
  const SelectedIcon = selectedNode.icon;
  const previewName = requests[0]?.customer.split(" ")[0] ?? "Customer";
  const reviewSlug = business.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const systemProtected = business.automationState !== "Live";
  const canToggle = canConfigure && !systemProtected;
  const templateIssues = useMemo(() => validateNeutralReviewTemplate(message), [message]);

  useEffect(() => setLive(!paused), [business.id, paused]);

  const save = () => {
    if (!canConfigure || templateIssues.length > 0) return;
    setSaveState("loading");
    window.setTimeout(() => {
      setSaveState("success");
      onSave();
      window.setTimeout(() => setSaveState("idle"), 1600);
    }, 450);
  };

  return (
    <div className="automation-layout">
      <section className="automation-canvas panel">
        <header className="automation-canvas__head">
          <div><h2>Google review request</h2><p>Linear sequence · every eligible customer follows the same route</p></div>
          <label className="switch-control"><span>{live ? "Live" : systemProtected ? "Protected" : "Paused"}</span><input type="checkbox" checked={live} disabled={!canToggle} onChange={(event) => { setLive(event.target.checked); onStateChange(event.target.checked); }} /><span className="switch-control__track"><span /></span></label>
        </header>
        {!canConfigure && <div className="automation-access-note"><ShieldCheck size={16} /><span>View-only support session. Start a configuration session with recent step-up verification to change this workflow.</span></div>}
        {canConfigure && systemProtected && <div className="automation-access-note automation-access-note--warning"><AlertTriangle size={16} /><span>{business.health}. Resolve the protecting exception before sending can resume; template changes remain available.</span></div>}
        <div className={cx("automation-guardrail", templateIssues.length > 0 && "automation-guardrail--blocked")}>
          {templateIssues.length > 0 ? <AlertTriangle size={17} /> : <ShieldCheck size={17} />}
          <span><strong>{templateIssues.length > 0 ? "Template blocked" : "Review gating blocked"}</strong> · {templateIssues.length > 0 ? "Resolve the copy checks before saving" : "neutral request · hard cap of three total messages"}</span>
        </div>
        <div className="automation-flow">
          {AUTOMATION_NODES.map((node, index) => {
            const Icon = node.icon;
            return (
              <div className="automation-flow__item" key={node.id}>
                <button type="button" className={cx("automation-node", selected === node.id && "is-selected")} onClick={() => setSelected(node.id)}>
                  <span><Icon size={18} /></span>
                  <span><strong>{node.label}</strong><small>{node.id === "wait" ? `Wait ${waitHours} hours · ` : ""}{node.description}</small></span>
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
                {index < AUTOMATION_NODES.length - 1 && <span className="automation-connector" aria-hidden="true"><Circle size={7} /></span>}
              </div>
            );
          })}
        </div>
      </section>
      <aside className="automation-editor panel">
        <header className="automation-editor__head"><span><SelectedIcon size={18} /></span><div><small>Edit action</small><h2>{selectedNode.label}</h2></div></header>
        {selected === "wait" ? (
          <div className="field-group"><label htmlFor="wait-hours">Wait time in hours</label><input id="wait-hours" type="number" min="1" max="168" value={waitHours} disabled={!canConfigure} onChange={(event) => setWaitHours(Number(event.target.value))} /><small>Pending messages cancel immediately after a reply, review detection or opt-out.</small></div>
        ) : selected === "request" || selected === "followup" ? (
          <>
            <div className="field-group"><label htmlFor="channel">Channel</label><select id="channel" defaultValue="SMS" disabled={!canConfigure}><option>SMS</option><option>Email</option></select><small>Messaging usage is billed separately from the subscription.</small></div>
            <div className="field-group"><label htmlFor="message-template">Message</label><textarea id="message-template" value={message} disabled={!canConfigure} onChange={(event) => setMessage(event.target.value)} rows={7} /><small>{message.length} characters · merge fields preview below</small></div>
            <div className={cx("template-validation", templateIssues.length > 0 && "template-validation--blocked")} role="status">
              {templateIssues.length > 0 ? <AlertTriangle size={17} /> : <ShieldCheck size={17} />}
              <span>
                <strong>{templateIssues.length > 0 ? "Copy needs attention" : "Neutral-copy checks passed"}</strong>
                {templateIssues.length > 0 ? <ul>{templateIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : <small>Business identification, review link and opt-out language are present; no gating, rating prompt or incentive was detected.</small>}
              </span>
            </div>
            <figure className="message-preview"><figcaption>Customer preview</figcaption><div><p>{message.replace("{{first_name}}", previewName).replace("{{business_name}}", business.name).replace("{{review_link}}", `g.page/r/${reviewSlug}/review`)}</p><span>SMS · Demo only</span></div></figure>
          </>
        ) : (
          <div className="editor-summary"><SelectedIcon size={22} /><h3>{selectedNode.label}</h3><p>{selectedNode.description}. This system action has no customer-facing message to edit.</p></div>
        )}
        <div className="automation-editor__actions"><span aria-live="polite">{saveState === "success" ? "Changes saved" : templateIssues.length > 0 ? "Template blocked by copy checks" : ""}</span><Button state={saveState === "idle" ? undefined : saveState} onClick={save} disabled={!canConfigure || templateIssues.length > 0}>{saveState === "loading" ? "Saving…" : saveState === "success" ? <><Check size={16} /> Saved</> : "Save changes"}</Button></div>
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
        <div><span>Current rating</span><strong>{business.metrics.rating.toFixed(1)}</strong><Stars rating={Math.round(business.metrics.rating)} size={18} /><small>{business.metrics.totalReviews} Google reviews · sample</small></div>
        <div><span>Detected this month</span><strong>{business.metrics.reviewsDetected}</strong><small>Last sync · {business.lastSuccess}</small></div>
        <div><span>Awaiting reply</span><strong>{awaitingReply}</strong><small>Owner replies remain on Google</small></div>
      </section>
      <section className="panel review-feed-panel">
        <header className="panel__head"><div><h2>Google review feed</h2><p>{business.name} · {business.locationName} · sample data</p></div><StatusPill tone={business.healthTone}>{business.healthTone === "success" && <CheckCircle2 size={14} />} {business.healthTone === "success" ? "Sync healthy" : "Check integration"}</StatusPill></header>
        <div className="review-feed">
          {reviews.map((review) => (
            <article key={review.id}>
              <div className="review-feed__top"><span className="review-avatar">{review.name[0]}</span><span><strong>{review.name}</strong><small>{review.date}</small></span><Stars rating={review.rating} /></div>
              <p>{review.body}</p>
              <div><StatusPill tone={review.replied ? "neutral" : "warning"}>{review.replied ? <><Check size={13} /> Replied</> : "Reply pending"}</StatusPill><button className="text-action" type="button" disabled aria-label="Google review link unavailable in this demo">Google link · Demo <ExternalLink size={14} /></button></div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function ReportsView({ business }: { business: BusinessAccount }) {
  const metrics = business.metrics;
  const operationalTone = business.healthTone === "success" ? "success" : "warning";
  return (
    <div className="view-stack">
      <DemoNotice />
      <section className="report-shell">
        <header className="report-toolbar"><div><span>Monthly report</span><strong>July 2026</strong></div><Button variant="secondary" onClick={() => window.print()}><Printer size={16} /> Print report</Button></header>
        <article className="report-paper">
          <header><Brand /><span>{business.name} · {business.locationName}</span><small>1–31 July 2026 · Sample report</small></header>
          <section className="report-intro"><p>{business.healthTone === "success" ? "Your review-request system ran without an integration failure this month." : `The system protected customer messaging while ${business.health.toLowerCase()} needs attention.`}</p><span className={`status-pill status-pill--${operationalTone}`}>{business.healthTone === "success" ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />} {business.health}</span></section>
          <section className="report-metrics"><div><span>Completed jobs</span><strong>{metrics.completedJobs}</strong></div><div><span>Requests delivered</span><strong>{metrics.delivered}</strong></div><div><span>Unique link clicks</span><strong>{metrics.uniqueClicks}</strong></div><div><span>New reviews detected</span><strong>{metrics.reviewsDetected}</strong></div></section>
          <section className="report-rating"><div><span>Google rating</span><strong>{metrics.rating.toFixed(1)}</strong><Stars rating={Math.round(metrics.rating)} size={17} /></div><p>{metrics.totalReviews} total reviews at month end. Review detection is not exact job-level attribution; estimated conversion is reported separately.</p></section>
          <section className="report-events"><h2>Operational checks</h2><div><span><CheckCircle2 size={16} /> Completed-job trigger</span><strong>Healthy</strong></div><div><span>{business.healthTone === "success" ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />} Google review sync</span><strong>{business.healthTone === "success" ? "Healthy" : "Attention"}</strong></div><div><span><CheckCircle2 size={16} /> Suppression list</span><strong>4 contacts</strong></div><div><span><AlertTriangle size={16} /> Failed delivery rate</span><strong>2.4%</strong></div></section>
          <footer><span>Afterword · Review automation</span><span>Sample data · Not a live client report</span></footer>
        </article>
      </section>
    </div>
  );
}

function IntegrationsView({ business, onConnect, canConfigure }: { business: BusinessAccount; onConnect: () => void; canConfigure: boolean }) {
  const integrations = [
    { key: "google", name: "Google Business Profile", detail: "Review sync and direct review destination", state: business.integrations.google, icon: MapPin },
    { key: "messaging", name: "Messaging provider", detail: "SMS and email delivery events", state: business.integrations.messaging, icon: Send },
    { key: "jobIntake", name: "Completed-job intake", detail: "Receives genuine customer job completions", state: business.integrations.jobIntake, icon: Webhook },
  ];
  const attentionCount = integrations.filter((integration) => integration.state.tone !== "success").length;
  return (
    <div className="view-stack">
      <DemoNotice />
      <section className="integration-grid">
        {integrations.map((integration) => {
          const Icon = integration.icon;
          return (
            <article className="integration-card" key={integration.name}>
              <span className="integration-card__icon"><Icon size={22} /></span>
              <div><h2>{integration.name}</h2><p>{integration.detail}</p></div>
              <StatusPill tone={integration.state.tone}>{integration.state.status}</StatusPill>
              <Button variant="secondary" disabled={!canConfigure || integration.key !== "google"} onClick={integration.key === "google" ? onConnect : undefined}>{integration.key === "google" ? "Review setup" : "Details · Demo"}</Button>
            </article>
          );
        })}
      </section>
      <section className="panel integration-log">
        <header className="panel__head"><div><h2>Integration event log</h2><p>Latest sample events · {business.name}</p></div><StatusPill tone={attentionCount ? "warning" : "success"}>{attentionCount ? `${attentionCount} need attention` : "No failures"}</StatusPill></header>
        {integrations.map((integration) => <div key={integration.key}><span>{integration.state.tone === "success" ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />} {integration.name}</span><small>{integration.state.lastEvent}</small></div>)}
      </section>
    </div>
  );
}

function AddJobDialog({ open, onClose, onAdd, businessId }: { open: boolean; onClose: () => void; onAdd: (request: RequestRecord) => void; businessId: string }) {
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
  const evidenceMissing = consentBasis === "Evidence missing";
  const phoneDigits = destination.replace(/\D/g, "");
  const destinationValid = channel === "SMS"
    ? phoneDigits.length >= 10 && phoneDigits.length <= 15
    : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination.trim());
  const consentEvidenceValid = evidenceMissing || Boolean(consentReference.trim() && consentCapturedAt && consentWordingVersion.trim());
  const invalid = !firstName.trim() || !job.trim() || !destinationValid || !consentEvidenceValid;
  const consentStatus: ConsentStatus = evidenceMissing ? "Missing" : "Verified";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (invalid) return;
    setSaving(true);
    window.setTimeout(() => {
      onAdd({
        id: `REQ-${1049 + Math.floor(Math.random() * 200)}`,
        businessId,
        customer: `${firstName.trim()} ${lastName.trim()}`.trim(),
        job: job.trim(),
        channel,
        destination: channel === "SMS" ? `•••• ${phoneDigits.slice(-4)}` : destination.replace(/^(.).+(@.+)$/, "$1•••$2"),
        status: evidenceMissing ? "Blocked" : "Queued",
        createdAt: "Just now",
        consentBasis,
        consentStatus,
        consentReference: evidenceMissing ? "Not supplied" : consentReference.trim(),
        consentCapturedAt: evidenceMissing ? "Not supplied" : consentCapturedAt,
        consentWordingVersion: evidenceMissing ? "Not supplied" : consentWordingVersion.trim(),
      });
      setSaving(false);
      setFirstName(""); setLastName(""); setJob(""); setDestination("");
      setConsentBasis("Booking form consent"); setConsentReference(""); setConsentCapturedAt(""); setConsentWordingVersion("review_request_v2");
      setTouched(false);
      onClose();
    }, 420);
  };

  return (
    <Modal open={open} onClose={onClose} label="Add a completed job">
      <form className="dialog-card" onSubmit={submit} noValidate>
        <header className="dialog-card__head"><div><span className="dialog-icon"><ClipboardCheck size={20} /></span><div><small>Demo workflow</small><h2>Add a completed job</h2></div></div><IconButton label="Close dialog" onClick={onClose}><X size={19} /></IconButton></header>
        <div className={cx("dialog-note", evidenceMissing ? "dialog-note--warning" : "dialog-note--verified")}>
          {evidenceMissing ? <AlertTriangle size={16} /> : <ShieldCheck size={16} />}
          <span>{evidenceMissing ? "Consent evidence is missing. The completed job will be recorded as blocked and cannot enter the messaging workflow." : "Evidence is checked before the in-memory request is queued. No customer will be contacted in this demo."}</span>
        </div>
        <div className="form-grid">
          <div className="field-group"><label htmlFor="first-name">First name</label><input id="first-name" value={firstName} onBlur={() => setTouched(true)} onChange={(event) => setFirstName(event.target.value)} aria-invalid={touched && !firstName ? "true" : undefined} placeholder="Amelia" /><small className={cx(touched && !firstName && "is-error")}>{touched && !firstName ? "Add the customer’s first name." : "Used for personalisation."}</small></div>
          <div className="field-group"><label htmlFor="last-name">Last name</label><input id="last-name" value={lastName} onChange={(event) => setLastName(event.target.value)} placeholder="Carter" /><small>Optional in customer messages.</small></div>
          <div className="field-group field-group--full"><label htmlFor="job-type">Completed job</label><input id="job-type" value={job} onBlur={() => setTouched(true)} onChange={(event) => setJob(event.target.value)} aria-invalid={touched && !job ? "true" : undefined} placeholder="Boiler service" /><small className={cx(touched && !job && "is-error")}>{touched && !job ? "Name the completed service or transaction." : "This should represent a genuine finished job."}</small></div>
          <div className="field-group"><label htmlFor="job-channel">Channel</label><select id="job-channel" value={channel} onChange={(event) => setChannel(event.target.value as Channel)}><option>SMS</option><option>Email</option></select><small>The demo will queue one neutral request.</small></div>
          <div className="field-group"><label htmlFor="destination">{channel === "SMS" ? "Mobile number" : "Email address"}</label><input id="destination" type={channel === "SMS" ? "tel" : "email"} value={destination} onBlur={() => setTouched(true)} onChange={(event) => setDestination(event.target.value)} aria-invalid={touched && !destinationValid ? "true" : undefined} placeholder={channel === "SMS" ? "07700 900482" : "amelia@example.com"} /><small className={cx(touched && !destinationValid && "is-error")}>{touched && !destinationValid ? `Add a valid ${channel === "SMS" ? "mobile number" : "email address"}.` : "Stored as masked demo data."}</small></div>
          <div className="field-group field-group--full"><label htmlFor="consent-basis">Consent evidence source</label><select id="consent-basis" value={consentBasis} onChange={(event) => setConsentBasis(event.target.value)}><option>Booking form consent</option><option>Service agreement consent</option><option>CRM consent record</option><option>Evidence missing</option></select><small>A customer relationship alone is not treated as consent evidence.</small></div>
          {!evidenceMissing && <>
            <div className="field-group"><label htmlFor="consent-reference">Booking or transaction reference</label><input id="consent-reference" value={consentReference} onBlur={() => setTouched(true)} onChange={(event) => setConsentReference(event.target.value)} aria-invalid={touched && !consentReference.trim() ? "true" : undefined} placeholder="JOB-2841" /><small className={cx(touched && !consentReference.trim() && "is-error")}>{touched && !consentReference.trim() ? "Add the evidence or transaction reference." : "Links this request to the source evidence."}</small></div>
            <div className="field-group"><label htmlFor="consent-captured-at">Consent captured at</label><input id="consent-captured-at" type="datetime-local" value={consentCapturedAt} onBlur={() => setTouched(true)} onChange={(event) => setConsentCapturedAt(event.target.value)} aria-invalid={touched && !consentCapturedAt ? "true" : undefined} /><small className={cx(touched && !consentCapturedAt && "is-error")}>{touched && !consentCapturedAt ? "Record when permission was captured." : "Stored with the evidence record."}</small></div>
            <div className="field-group field-group--full"><label htmlFor="consent-wording-version">Consent wording version</label><input id="consent-wording-version" value={consentWordingVersion} onBlur={() => setTouched(true)} onChange={(event) => setConsentWordingVersion(event.target.value)} aria-invalid={touched && !consentWordingVersion.trim() ? "true" : undefined} /><small className={cx(touched && !consentWordingVersion.trim() && "is-error")}>{touched && !consentWordingVersion.trim() ? "Record the exact wording version shown to the customer." : "The production record also retains the approved wording and withdrawal history."}</small></div>
          </>}
        </div>
        <footer className="dialog-card__actions"><Button variant="quiet" onClick={onClose}>Cancel</Button><Button type="submit" state={saving ? "loading" : undefined}>{saving ? "Adding job…" : evidenceMissing ? "Add blocked record" : "Add and queue request"}</Button></footer>
      </form>
    </Modal>
  );
}

function OnboardingDialog({ open, onClose, business, canConfigure, onActivate }: { open: boolean; onClose: () => void; business: BusinessAccount; canConfigure: boolean; onActivate: () => void }) {
  const [step, setStep] = useState(0);
  const [source, setSource] = useState("Webhook");
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [activated, setActivated] = useState(false);
  const steps = ["Google profile", "Job source", "Message", "Activate"];
  const templateIssues = useMemo(() => validateNeutralReviewTemplate(template), [template]);

  const finish = () => {
    if (!canConfigure || templateIssues.length > 0) return;
    onActivate();
    setActivated(true);
    window.setTimeout(() => {
      setActivated(false);
      setStep(0);
      onClose();
    }, 850);
  };

  return (
    <Modal open={open} onClose={onClose} label="Connect Google Business Profile" className="dialog--wide">
      <div className="dialog-card onboarding-card">
        <header className="dialog-card__head"><div><span className="dialog-icon"><MapPin size={20} /></span><div><small>Simulated onboarding</small><h2>Connect Google Business Profile</h2></div></div><IconButton label="Close onboarding" onClick={onClose}><X size={19} /></IconButton></header>
        <div className="onboarding-progress" aria-label={`Step ${step + 1} of ${steps.length}`}>
          {steps.map((label, index) => <span key={label} className={cx(index < step && "is-complete", index === step && "is-active")}><i>{index < step ? <Check size={13} /> : index + 1}</i><b>{label}</b></span>)}
        </div>
        <div className="onboarding-body">
          {step === 0 && <><div className="dialog-note"><AlertTriangle size={16} /><span>{canConfigure ? "Demo only. No OAuth window opens and no external account is changed." : "View-only support cannot change integrations. Start a configuration support session to continue."}</span></div><h3>Select a verified location</h3><label className="choice-card is-selected"><input type="radio" name="profile" defaultChecked /><span className="choice-card__icon"><Building2 size={20} /></span><span><strong>{business.name}</strong><small>{business.locationName} · Verified demo profile</small></span><CheckCircle2 size={18} /></label><p className="onboarding-help">A production connection uses Google OAuth with explicit owner permission and revocable access.</p></>}
          {step === 1 && <><h3>How do completed jobs arrive?</h3><p className="onboarding-help">Pick the first source. More can be added after activation.</p><div className="choice-grid">{[{ label: "Webhook", detail: "Booking or CRM event", icon: Webhook }, { label: "CSV import", detail: "Upload a completed-job file", icon: FileText }, { label: "Manual entry", detail: "Add from the dashboard", icon: Plus }].map((choice) => { const Icon = choice.icon; return <label key={choice.label} className={cx("choice-card", source === choice.label && "is-selected")}><input type="radio" name="source" value={choice.label} checked={source === choice.label} onChange={() => setSource(choice.label)} /><span className="choice-card__icon"><Icon size={20} /></span><span><strong>{choice.label}</strong><small>{choice.detail}</small></span>{source === choice.label && <CheckCircle2 size={18} />}</label>; })}</div></>}
          {step === 2 && <><h3>Approve the neutral request</h3><div className="field-group"><label htmlFor="onboarding-template">SMS template</label><textarea id="onboarding-template" rows={6} value={template} onChange={(event) => setTemplate(event.target.value)} /><small>{template.length} characters · live checks enforce identification, review-link and opt-out requirements.</small></div><div className={cx("template-guard", templateIssues.length > 0 && "template-guard--blocked")} role="status">{templateIssues.length > 0 ? <AlertTriangle size={18} /> : <ShieldCheck size={18} />}<span><strong>{templateIssues.length > 0 ? "Template blocked" : "Guardrail active"}</strong>{templateIssues.length > 0 ? <ul>{templateIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : <small>No sentiment screen, incentive or suggested rating detected.</small>}</span></div></>}
          {step === 3 && <><h3>Pre-flight checks</h3><div className="preflight-list"><span><CheckCircle2 size={17} /><strong>Demo Google profile selected</strong><small>{business.name} · {business.locationName}</small></span><span><CheckCircle2 size={17} /><strong>Completed-job source ready</strong><small>{source}</small></span><span><CheckCircle2 size={17} /><strong>Neutral template approved</strong><small>Maximum two messages in this sequence</small></span><span><CheckCircle2 size={17} /><strong>Suppression and quiet hours active</strong><small>STOP cancels pending messages immediately</small></span></div>{activated && <div className="activation-success" aria-live="polite"><CheckCircle2 size={20} /> Demo automation activated</div>}</>}
        </div>
        <footer className="dialog-card__actions"><Button variant="quiet" disabled={step === 0 || activated} onClick={() => setStep((value) => Math.max(0, value - 1))}>Back</Button><span>Step {step + 1} of {steps.length}</span>{step < steps.length - 1 ? <Button disabled={!canConfigure || (step === 2 && templateIssues.length > 0)} onClick={() => setStep((value) => value + 1)}>Continue <ArrowRight size={16} /></Button> : <Button disabled={!canConfigure || templateIssues.length > 0} state={activated ? "success" : undefined} onClick={finish}>{activated ? <><Check size={16} /> Activated</> : "Activate demo"}</Button>}</footer>
      </div>
    </Modal>
  );
}

function SupportSessionBanner({ supportSession, business, actor, onEnd }: { supportSession: SupportSession; business: BusinessAccount; actor: string; onEnd: () => void }) {
  const expiresAt = new Date(supportSession.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="support-session-banner" role="status">
      <span className="support-session-banner__icon"><ShieldCheck size={18} /></span>
      <span><strong>Audited support session · {supportSession.scope === "configuration" ? "Configuration" : "View only"}</strong><small>{actor} is accessing {business.name} · reason recorded · expires {expiresAt}</small></span>
      <Button variant="secondary" onClick={onEnd}>End session</Button>
    </div>
  );
}

function SupportSessionDialog({ business, session, onClose, onStart }: { business: BusinessAccount | null; session: SessionContext; onClose: () => void; onStart: (input: { scope: SupportScope; reason: string; durationMinutes: 15 | 30 | 60 }) => void }) {
  const [scope, setScope] = useState<SupportScope>("view");
  const [reason, setReason] = useState("Investigate integration exception");
  const [durationMinutes, setDurationMinutes] = useState<15 | 30 | 60>(15);
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

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (invalid) return;
    try {
      onStart({ scope, reason: reason.trim(), durationMinutes });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Support access could not be started.");
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
          <div className="field-group"><label htmlFor="support-duration">Session length</label><select id="support-duration" value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value) as 15 | 30 | 60)}><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={60}>60 minutes</option></select><small>Access expires automatically.</small></div>
        </div>
        {scope === "configuration" && <div className={cx("step-up-confirmation", !stepUpFresh && "step-up-confirmation--warning")}>{stepUpFresh ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}<span><strong>{stepUpFresh ? "Recent step-up verified" : "Step-up verification required"}</strong><small>{stepUpFresh ? "Verified within the last 10 minutes." : "Configuration access remains blocked until MFA is verified again."}</small></span></div>}
        {submitError && <div className="dialog-error" role="alert"><AlertTriangle size={16} /> {submitError}</div>}
        <footer className="dialog-card__actions"><Button variant="quiet" onClick={onClose}>Cancel</Button><Button type="submit" disabled={invalid}><ShieldCheck size={16} /> Start session</Button></footer>
      </form>
    </Modal>
  );
}

function PauseScopeDialog({ business, paused, onClose, onConfirm }: { business: BusinessAccount | null; paused: boolean; onClose: () => void; onConfirm: (input: { reason: string; notifyClient: boolean }) => void }) {
  const [reason, setReason] = useState("");
  const [notifyClient, setNotifyClient] = useState(true);
  const [touched, setTouched] = useState(false);
  const invalid = reason.trim().length < 8;

  useEffect(() => {
    if (!business) return;
    setReason(paused ? "Issue resolved; resume approved" : "Protect sending while issue is investigated");
    setNotifyClient(true);
    setTouched(false);
  }, [business, paused]);

  if (!business) return null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (invalid) return;
    onConfirm({ reason: reason.trim(), notifyClient });
  };

  return (
    <Modal open onClose={onClose} label={`${paused ? "Review pause" : "Pause automation"} for ${business.name}`}>
      <form className="dialog-card pause-dialog" onSubmit={submit} noValidate>
        <header className="dialog-card__head"><div><span className="dialog-icon dialog-icon--warning"><PauseCircle size={20} /></span><div><small>Scoped safety control</small><h2>{paused ? "Resume this client scope?" : "Pause this client scope?"}</h2></div></div><IconButton label="Close pause dialog" onClick={onClose}><X size={19} /></IconButton></header>
        <p className="dialog-explainer">{paused ? `Queued work for ${business.name} can continue after the scope is resumed.` : `New sends for ${business.name} will be held safely. Queued work is retained and no other client is affected.`}</p>
        <div className="field-group"><label htmlFor="pause-reason">Reason</label><textarea id="pause-reason" rows={4} value={reason} onBlur={() => setTouched(true)} onChange={(event) => setReason(event.target.value)} aria-invalid={touched && invalid ? "true" : undefined} /><small className={cx(touched && invalid && "is-error")}>{touched && invalid ? "Record a specific reason of at least 8 characters." : "Required for the append-only audit record."}</small></div>
        <label className="checkbox-row"><input type="checkbox" checked={notifyClient} onChange={(event) => setNotifyClient(event.target.checked)} /><span><strong>Notify the client owner</strong><small>Demo notification only; no message is sent.</small></span></label>
        <footer className="dialog-card__actions"><Button variant="quiet" onClick={onClose}>Cancel</Button><Button type="submit" variant={paused ? "primary" : "danger"}>{paused ? "Resume scope" : "Pause scope"}</Button></footer>
      </form>
    </Modal>
  );
}

function AppShell({ initialView, onBack, onboardingOpen, setOnboardingOpen }: { initialView: AppView; onBack: () => void; onboardingOpen: boolean; setOnboardingOpen: (open: boolean) => void }) {
  const compactViewport = useMediaQuery("(max-width: 59.999rem)");
  const [view, setView] = useState<AppView>(initialView);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [addJobOpen, setAddJobOpen] = useState(false);
  const [session, setSession] = useState<SessionContext>(OWNER_SESSION);
  const [supportSession, setSupportSession] = useState<SupportSession | null>(null);
  const [selectedBusinessId, setSelectedBusinessId] = useState(OWNER_SESSION.businessId ?? BUSINESSES[0].id);
  const [supportDialogBusiness, setSupportDialogBusiness] = useState<BusinessAccount | null>(null);
  const [pauseDialogBusiness, setPauseDialogBusiness] = useState<BusinessAccount | null>(null);
  const [requestsByBusiness, setRequestsByBusiness] = useState<Record<string, RequestRecord[]>>(() => Object.fromEntries(
    Object.entries(INITIAL_REQUESTS_BY_BUSINESS).map(([businessId, requests]) => [businessId, [...requests]]),
  ));
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>(INITIAL_AUDIT_EVENTS);
  const [qrCodesByBusiness, setQrCodesByBusiness] = useState<Record<string, QrCodeRecord>>(() => Object.fromEntries(
    Object.entries(INITIAL_QR_CODES_BY_BUSINESS).map(([businessId, record]) => [businessId, { ...record, placements: record.placements.map((placement) => ({ ...placement })) }]),
  ));
  const [pausedBusinessIds, setPausedBusinessIds] = useState<Set<string>>(() => new Set());

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
      setAddJobOpen(false);
      setOnboardingOpen(false);
      setView("agency-overview");
    };
    if (remaining <= 0) {
      expire();
      return;
    }
    const timer = window.setTimeout(expire, remaining);
    return () => window.clearTimeout(timer);
  }, [setOnboardingOpen, supportSession]);

  const agencyMode = session.role === "agency_admin" && !supportSession;
  const business = getBusiness(supportSession?.businessId ?? session.businessId ?? selectedBusinessId);
  const requests = requestsByBusiness[business.id] ?? [];
  const reviews = REVIEWS_BY_BUSINESS[business.id] ?? [];
  const canReadTenant = canReadTenantData(session, business.id, supportSession);
  const canConfigure = canConfigureTenant(session, business.id, supportSession);
  const paused = pausedBusinessIds.has(business.id) || business.automationState !== "Live";
  const navItems = agencyMode ? AGENCY_NAV : CLIENT_NAV;
  const page = [...CLIENT_NAV, ...AGENCY_NAV].find((item) => item.id === view) ?? navItems[0];
  const descriptions: Record<AppView, string> = {
    overview: "Reputation performance and automation health at a glance.",
    requests: "Every completed job, message event and suppression state.",
    automation: "A neutral review journey with fewer moving parts.",
    reviews: "New Google reviews and owner-reply status.",
    "qr-codes": "Permanent client QR artwork, scan tracking and Google conversion signals.",
    reports: "A simple monthly proof-of-value report.",
    integrations: "Google, messaging and completed-job sources.",
    "team-billing": "Tenant-scoped members, roles, subscription and usage.",
    "agency-overview": "Portfolio health, protected failures and client impact.",
    clients: "Managed businesses, integrations and scoped controls.",
    exceptions: "Operational failures with impact and safe resolution paths.",
    audit: "Append-only evidence for administrative and support actions.",
  };

  const recordAudit = (event: Omit<AuditEvent, "id" | "correlationId">) => {
    setAuditEvents((current) => [makeAuditEvent(event), ...current]);
  };

  const endSupportSession = () => {
    if (!supportSession) return;
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
    setSupportSession(null);
    setAddJobOpen(false);
    setOnboardingOpen(false);
    setView("agency-overview");
  };

  const exitWorkspace = () => {
    if (supportSession) {
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
      setSupportSession(null);
    }
    setAddJobOpen(false);
    setOnboardingOpen(false);
    onBack();
  };

  const changeRole = (role: ActorRole) => {
    if (role === session.role && !supportSession) return;
    if (supportSession) endSupportSession();
    setSupportDialogBusiness(null);
    setPauseDialogBusiness(null);
    setAddJobOpen(false);
    setOnboardingOpen(false);
    if (role === "agency_admin") {
      setSession({ ...ADMIN_SESSION, stepUpVerifiedAt: new Date().toISOString() });
      setView("agency-overview");
    } else {
      setSession(OWNER_SESSION);
      setSelectedBusinessId(OWNER_SESSION.businessId ?? BUSINESSES[0].id);
      setView("overview");
    }
  };

  const beginSupportSession = (input: { scope: SupportScope; reason: string; durationMinutes: 15 | 30 | 60 }) => {
    if (!supportDialogBusiness) return;
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
    setView("overview");
  };

  const confirmPauseChange = ({ reason, notifyClient }: { reason: string; notifyClient: boolean }) => {
    if (!pauseDialogBusiness) return;
    const wasPaused = pausedBusinessIds.has(pauseDialogBusiness.id);
    if (!wasPaused && pauseDialogBusiness.automationState !== "Live") {
      recordAudit({
        occurredAt: "Just now",
        actor: session.userName,
        actorType: "user",
        businessId: pauseDialogBusiness.id,
        action: "automation.resume",
        resource: `${pauseDialogBusiness.locationName} automation scope`,
        outcome: "Blocked",
        reason: "System protection must be resolved before resuming",
      });
      setPauseDialogBusiness(null);
      return;
    }
    setPausedBusinessIds((current) => {
      const next = new Set(current);
      if (wasPaused) next.delete(pauseDialogBusiness.id);
      else next.add(pauseDialogBusiness.id);
      return next;
    });
    recordAudit({
      occurredAt: "Just now",
      actor: session.userName,
      actorType: "user",
      businessId: pauseDialogBusiness.id,
      action: wasPaused ? "automation.resume" : "automation.pause",
      resource: `${pauseDialogBusiness.locationName} automation scope`,
      outcome: "Completed",
      supportSessionId: supportSession?.id,
      reason: `${reason}${notifyClient ? " · client notification queued" : ""}`,
    });
    setPauseDialogBusiness(null);
  };

  const addRequest = (request: RequestRecord) => {
    if (!canConfigure || request.businessId !== business.id) return;
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
    setView("requests");
  };

  const changeAutomationState = (live: boolean) => {
    if (!canConfigure) return;
    if (live && business.automationState !== "Live") {
      recordAudit({ occurredAt: "Just now", actor: session.userName, actorType: "user", businessId: business.id, action: "automation.resume", resource: `${business.locationName} automation scope`, outcome: "Blocked", supportSessionId: supportSession?.id, reason: "Protecting exception remains active" });
      return;
    }
    setPausedBusinessIds((current) => {
      const next = new Set(current);
      if (live) next.delete(business.id);
      else next.add(business.id);
      return next;
    });
    recordAudit({ occurredAt: "Just now", actor: session.userName, actorType: "user", businessId: business.id, action: live ? "automation.resume" : "automation.pause", resource: `${business.locationName} automation scope`, outcome: "Completed", supportSessionId: supportSession?.id, reason: "Changed from the automation workspace" });
  };

  const recordAutomationSave = () => {
    if (!canConfigure) return;
    recordAudit({ occurredAt: "Just now", actor: session.userName, actorType: "user", businessId: business.id, action: "automation.update", resource: "Google review request sequence", outcome: "Completed", supportSessionId: supportSession?.id, reason: "Template or timing saved" });
  };

  const recordIntegrationActivation = () => {
    if (!canConfigure) return;
    recordAudit({ occurredAt: "Just now", actor: session.userName, actorType: "user", businessId: business.id, action: "integration.setup", resource: "Google Business Profile", outcome: "Completed", supportSessionId: supportSession?.id, reason: "Simulated onboarding activation" });
  };

  const updateQrCode = (record: QrCodeRecord) => {
    if (!canConfigure || record.businessId !== business.id) return;
    setQrCodesByBusiness((current) => ({ ...current, [business.id]: record }));
  };

  const recordQrAudit = (action: string, reason: string) => {
    recordAudit({
      occurredAt: "Just now",
      actor: session.userName,
      actorType: "user",
      businessId: business.id,
      action,
      resource: qrCodesByBusiness[business.id]?.publicToken ?? "QR artwork",
      outcome: "Completed",
      supportSessionId: supportSession?.id,
      reason,
    });
  };

  const headerActions = agencyMode ? (
    <IconButton label="Agency alerts are simulated in this demo" disabled><Bell size={19} /></IconButton>
  ) : (
    <>
      <IconButton label="Alerts are simulated in this demo" disabled><Bell size={19} /></IconButton>
      {view === "overview" || view === "requests" ? <Button disabled={!canConfigure} onClick={() => setAddJobOpen(true)}><Plus size={16} /> Add job</Button> : view === "integrations" ? <Button disabled={!canConfigure} onClick={() => setOnboardingOpen(true)}><Link2 size={16} /> Connect Google</Button> : undefined}
    </>
  );

  const supportBanner = supportSession ? (
    <SupportSessionBanner supportSession={supportSession} business={business} actor={session.userName} onEnd={endSupportSession} />
  ) : undefined;

  return (
    <div className="app-shell">
      <AppSidebar
        view={view}
        onView={setView}
        onBack={exitWorkspace}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        navItems={navItems}
        business={business}
        session={session}
        supportSession={supportSession}
        onRoleChange={changeRole}
        compactViewport={compactViewport}
      />
      {sidebarOpen && <button type="button" className="sidebar-scrim" aria-label="Close workspace navigation" onClick={() => setSidebarOpen(false)} />}
      <main className={cx("app-main", supportSession && "app-main--support")}>
        <PageHeader title={page.label} description={descriptions[view]} onMenu={() => setSidebarOpen(true)} navigationOpen={sidebarOpen} actions={headerActions} banner={supportBanner} />
        <div className="app-content">
          {agencyMode && view === "agency-overview" && <AgencyOverviewView businesses={BUSINESSES} exceptions={PLATFORM_EXCEPTIONS} pausedBusinessIds={pausedBusinessIds} onView={setView} onStartSupport={setSupportDialogBusiness} />}
          {agencyMode && view === "clients" && <ClientsView businesses={BUSINESSES} pausedBusinessIds={pausedBusinessIds} onStartSupport={setSupportDialogBusiness} onPause={setPauseDialogBusiness} />}
          {agencyMode && view === "exceptions" && <ExceptionsView businesses={BUSINESSES} exceptions={PLATFORM_EXCEPTIONS} pausedBusinessIds={pausedBusinessIds} onStartSupport={setSupportDialogBusiness} onPause={setPauseDialogBusiness} />}
          {agencyMode && view === "audit" && <AuditLogView businesses={BUSINESSES} events={auditEvents} />}
          {!agencyMode && !canReadTenant && <section className="panel access-expired"><ShieldCheck size={26} /><h2>Support access expired.</h2><p>Tenant data is no longer available. End this session and start a new, explicitly scoped session if support is still required.</p><Button onClick={endSupportSession}>Return to portfolio</Button></section>}
          {!agencyMode && canReadTenant && view === "overview" && <OverviewView business={business} requests={requests} reviews={reviews} onAddJob={() => setAddJobOpen(true)} onView={setView} canConfigure={canConfigure} paused={paused} />}
          {!agencyMode && canReadTenant && view === "requests" && <RequestsView requests={requests} onAddJob={() => setAddJobOpen(true)} canConfigure={canConfigure} />}
          {!agencyMode && canReadTenant && view === "automation" && <AutomationView business={business} requests={requests} canConfigure={canConfigure} paused={paused} onStateChange={changeAutomationState} onSave={recordAutomationSave} />}
          {!agencyMode && canReadTenant && view === "reviews" && <ReviewsView business={business} reviews={reviews} />}
          {!agencyMode && canReadTenant && view === "qr-codes" && qrCodesByBusiness[business.id] && <QrCodesView business={business} record={qrCodesByBusiness[business.id]} canConfigure={canConfigure} onUpdate={updateQrCode} onAudit={recordQrAudit} />}
          {!agencyMode && canReadTenant && view === "reports" && <ReportsView business={business} />}
          {!agencyMode && canReadTenant && view === "integrations" && <IntegrationsView business={business} onConnect={() => setOnboardingOpen(true)} canConfigure={canConfigure} />}
          {!agencyMode && canReadTenant && view === "team-billing" && <TeamBillingView business={business} canConfigure={canConfigure} />}
        </div>
      </main>
      <AddJobDialog open={addJobOpen && canConfigure} onClose={() => setAddJobOpen(false)} onAdd={addRequest} businessId={business.id} />
      <OnboardingDialog open={onboardingOpen} onClose={() => setOnboardingOpen(false)} business={business} canConfigure={canConfigure} onActivate={recordIntegrationActivation} />
      <SupportSessionDialog business={supportDialogBusiness} session={session} onClose={() => setSupportDialogBusiness(null)} onStart={beginSupportSession} />
      <PauseScopeDialog business={pauseDialogBusiness} paused={Boolean(pauseDialogBusiness && pausedBusinessIds.has(pauseDialogBusiness.id))} onClose={() => setPauseDialogBusiness(null)} onConfirm={confirmPauseChange} />
    </div>
  );
}

export default function App() {
  const [surface, setSurface] = useState<Surface>("site");
  const [initialView, setInitialView] = useState<AppView>("overview");
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const publicToken = window.location.pathname.match(/^\/r\/([a-z0-9-]+)\/?$/i)?.[1];
  const publicQrCode = publicToken ? getQrCodeByToken(publicToken) : undefined;

  const openApp = (view: AppView = "overview") => {
    setInitialView(view);
    setSurface("app");
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  const startSetup = () => {
    setInitialView("overview");
    setSurface("app");
    setOnboardingOpen(true);
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  if (publicQrCode) return <PublicReviewFlow business={getBusiness(publicQrCode.businessId)} record={publicQrCode} />;
  if (surface === "site") return <MarketingSite onOpenDemo={() => openApp()} onStartSetup={startSetup} />;

  return <AppShell initialView={initialView} onBack={() => { setSurface("site"); setOnboardingOpen(false); }} onboardingOpen={onboardingOpen} setOnboardingOpen={setOnboardingOpen} />;
}
