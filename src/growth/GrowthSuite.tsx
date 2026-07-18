import {
  BadgeCheck,
  BookOpen,
  Gauge,
  Gift,
  Globe,
  LayoutDashboard,
  PhoneCall,
  Settings,
  Shield,
  Star,
  TrendingUp,
  Video,
  XCircle,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { MemoryRouter, Navigate, NavLink, Route, Routes } from "react-router-dom";
import { AppProvider } from "./store";
import TopBar from "./components/TopBar";
import Dashboard from "./pages/Dashboard";
import Businesses from "./pages/Businesses";
import Automation from "./pages/Automation";
import Reviews from "./pages/Reviews";
import Reports from "./pages/Reports";
import Website from "./pages/Website";
import Citations from "./pages/Citations";
import SettingsPage from "./pages/Settings";
import Churn from "./pages/Churn";
import PartnerHub from "./pages/PartnerHub";
import Refer from "./pages/Refer";
import VideoEditor from "./pages/VideoEditor";
import Audit from "./pages/Audit";
import Sam from "./pages/Sam";

const TABS: Array<{ to: string; label: string; icon: LucideIcon }> = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/businesses", label: "Local SEO audit", icon: BadgeCheck },
  { to: "/automation", label: "Automation studio", icon: Zap },
  { to: "/reviews", label: "Review studio", icon: Star },
  { to: "/reports", label: "Rank reports", icon: TrendingUp },
  { to: "/website", label: "Website", icon: Globe },
  { to: "/citations", label: "Citations", icon: BookOpen },
  { to: "/churn", label: "Churn prevention", icon: XCircle },
  { to: "/audit", label: "Free audit", icon: Gauge },
  { to: "/sam", label: "Sam · Sales", icon: PhoneCall },
  { to: "/video-editor", label: "Video studio", icon: Video },
  { to: "/partner-hub", label: "Partner hub", icon: Shield },
  { to: "/refer", label: "Refer", icon: Gift },
  { to: "/settings", label: "White-label", icon: Settings },
];

export default function GrowthSuite() {
  return (
    <AppProvider>
      <MemoryRouter initialEntries={["/dashboard"]}>
        <div className="growth-suite">
          <div className="growth-suite__notice">
            <span className="demo-label">Preview · sample data</span>
            <p>
              These tools are a design preview running on sample data. They are not connected to your live workspace and
              nothing here contacts a customer, changes billing or writes to your records. Each area needs its own data
              source before it can go live: map-rank tracking needs a rank-tracking provider, listings need a citation
              distributor, and the sales workspace needs a lead provider. Your live review requests, reviews, QR codes,
              billing and integrations are in the main workspace navigation.
            </p>
          </div>
          <TopBar />
          <nav className="growth-tabs" aria-label="Growth suite sections">
            {TABS.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} className={({ isActive }) => (isActive ? "is-active" : undefined)}>
                <Icon size={15} aria-hidden="true" /> {label}
              </NavLink>
            ))}
          </nav>
          <div className="growth-suite__body">
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/businesses" element={<Businesses />} />
              <Route path="/automation" element={<Automation />} />
              <Route path="/reviews" element={<Reviews />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/website" element={<Website />} />
              <Route path="/citations" element={<Citations />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/churn" element={<Churn />} />
              <Route path="/partner-hub" element={<PartnerHub />} />
              <Route path="/refer" element={<Refer />} />
              <Route path="/video-editor" element={<VideoEditor />} />
              <Route path="/audit" element={<Audit />} />
              <Route path="/sam" element={<Sam />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </div>
        </div>
      </MemoryRouter>
    </AppProvider>
  );
}
