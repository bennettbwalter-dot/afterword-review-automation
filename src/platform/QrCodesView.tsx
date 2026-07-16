import {
  BarChart3,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileImage,
  FileText,
  Image as ImageIcon,
  Link2,
  QrCode,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Smartphone,
  TrendingUp,
} from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { BusinessAccount, QrCodeRecord } from "./domain";

const PUBLIC_REVIEW_BASE_URL = (import.meta.env.VITE_PUBLIC_REVIEW_BASE_URL || window.location.origin).replace(/\/$/, "");

export function getPublicReviewUrl(publicToken: string) {
  return `${PUBLIC_REVIEW_BASE_URL}/r/${publicToken}`;
}

function safeFileName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

function isLikelyDirectGoogleReviewUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "");
    return url.protocol === "https:" && (
      (host === "g.page" && /\/r\/.+\/review\/?$/i.test(url.pathname))
      || (host === "search.google.com" && url.pathname === "/local/writereview" && url.searchParams.has("placeid"))
      || (host.endsWith("google.com") && /\/maps\/place\//i.test(url.pathname))
    );
  } catch {
    return false;
  }
}

async function createPng(reviewUrl: string, width = 2048) {
  return QRCode.toDataURL(reviewUrl, {
    width,
    margin: 4,
    errorCorrectionLevel: "H",
    color: { dark: "#171613", light: "#fffdf8" },
  });
}

export function QrCodesView({
  business,
  record,
  canConfigure,
  onUpdate,
  onAudit,
}: {
  business: BusinessAccount;
  record: QrCodeRecord;
  canConfigure: boolean;
  onUpdate: (record: QrCodeRecord) => void;
  onAudit: (action: string, reason: string) => void;
}) {
  const [preview, setPreview] = useState("");
  const [destination, setDestination] = useState(record.destinationUrl);
  const [destinationError, setDestinationError] = useState("");
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState<"PNG" | "SVG" | "PDF" | null>(null);
  const reviewUrl = getPublicReviewUrl(record.publicToken);
  const conversionRate = record.totalScans ? (record.reviewConversions / record.totalScans) * 100 : 0;
  const maxPlacementScans = Math.max(...record.placements.map((placement) => placement.scans), 1);
  const fileBase = `${safeFileName(business.name)}-${safeFileName(business.locationName)}-google-review-qr`;

  useEffect(() => {
    let current = true;
    createPng(reviewUrl, 720).then((dataUrl) => {
      if (current) setPreview(dataUrl);
    });
    return () => { current = false; };
  }, [reviewUrl, record.artworkRevision]);

  useEffect(() => {
    setDestination(record.destinationUrl);
    setDestinationError("");
  }, [record.businessId, record.destinationUrl]);

  const trackingRows = useMemo(() => [
    { label: "Today · 14:08", detail: "Mobile · Bristol", outcome: "Continued to Google" },
    { label: "Today · 11:42", detail: "Mobile · Bristol", outcome: "Scan recorded" },
    { label: "Yesterday · 17:26", detail: "Tablet · Bath", outcome: "Review detected" },
  ], []);

  const copyLink = async () => {
    await navigator.clipboard.writeText(reviewUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const exportQr = async (format: "PNG" | "SVG" | "PDF") => {
    setExporting(format);
    try {
      if (format === "PNG") {
        const png = await createPng(reviewUrl);
        const blob = await fetch(png).then((response) => response.blob());
        downloadBlob(blob, `${fileBase}.png`);
      } else if (format === "SVG") {
        const svg = await QRCode.toString(reviewUrl, {
          type: "svg",
          margin: 4,
          errorCorrectionLevel: "H",
          color: { dark: "#171613", light: "#fffdf8" },
        });
        downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), `${fileBase}.svg`);
      } else {
        const [{ jsPDF }, png] = await Promise.all([import("jspdf"), createPng(reviewUrl, 1400)]);
        const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
        pdf.setFillColor(255, 253, 248);
        pdf.rect(0, 0, 210, 297, "F");
        pdf.setTextColor(23, 22, 19);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(24);
        pdf.text("How did we do?", 105, 38, { align: "center" });
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(12);
        pdf.text(`Scan to leave an honest Google review for ${business.name}.`, 105, 49, { align: "center", maxWidth: 150 });
        pdf.addImage(png, "PNG", 45, 66, 120, 120);
        pdf.setFontSize(11);
        pdf.setFont("helvetica", "bold");
        pdf.text(`${business.name} · ${business.locationName}`, 105, 202, { align: "center" });
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(8);
        pdf.setTextColor(92, 88, 80);
        pdf.text(reviewUrl, 105, 212, { align: "center", maxWidth: 160 });
        pdf.text(`Artwork revision ${record.artworkRevision} · Generated by Afterword`, 105, 282, { align: "center" });
        pdf.save(`${fileBase}.pdf`);
      }
      onAudit("qr.artwork.download", `${format} · revision ${record.artworkRevision}`);
    } finally {
      setExporting(null);
    }
  };

  const saveDestination = (event: FormEvent) => {
    event.preventDefault();
    let parsed: URL;
    try {
      parsed = new URL(destination);
    } catch {
      setDestinationError("Enter the full HTTPS Google review URL.");
      return;
    }
    if (parsed.protocol !== "https:") {
      setDestinationError("The review destination must use HTTPS.");
      return;
    }
    const verified = isLikelyDirectGoogleReviewUrl(destination);
    if (!verified) {
      setDestinationError("Use Google’s direct review link, not a general website or search result.");
      return;
    }
    onUpdate({ ...record, destinationUrl: destination, destinationVerified: true });
    onAudit("qr.destination.update", "Verified Google review destination saved");
    setDestinationError("");
  };

  const regenerate = () => {
    const next = { ...record, artworkRevision: record.artworkRevision + 1, generatedAt: "Just now" };
    onUpdate(next);
    onAudit("qr.artwork.regenerate", `Revision ${next.artworkRevision}; public token unchanged`);
  };

  return (
    <div className="view-stack qr-workspace">
      <div className="demo-notice">
        <span className="demo-label">Client owned</span>
        <p>This QR belongs only to {business.name}. Regenerating the artwork never changes its permanent public token or switches another client’s destination.</p>
      </div>

      <section className="metric-grid qr-metric-grid" aria-label="QR performance metrics">
        <article className="metric-card"><span>Total scans</span><strong>{record.totalScans}</strong><small>All recorded opens</small></article>
        <article className="metric-card"><span>Unique scanners</span><strong>{record.uniqueScans}</strong><small>{record.totalScans - record.uniqueScans} repeat scans excluded</small></article>
        <article className="metric-card metric-card--success"><span>Reviews attributed</span><strong>{record.reviewConversions}</strong><small>Detected after a QR visit</small></article>
        <article className="metric-card"><span>Scan to review</span><strong>{conversionRate.toFixed(1)}%</strong><small>Time-window attribution</small></article>
      </section>

      <section className="qr-layout">
        <article className="panel qr-artwork-card">
          <header className="panel__head"><div><h2>Master review QR</h2><p>One permanent code for this client’s printed and digital material</p></div><span className="status-pill status-pill--success"><ShieldCheck size={14} /> Active</span></header>
          <div className="qr-artwork-card__body">
            <div className="qr-preview" aria-label={`QR code for ${business.name}`}>
              {preview ? <img src={preview} alt={`Scan to review ${business.name} on Google`} /> : <span className="qr-preview__loading"><QrCode size={44} /> Generating preview</span>}
              <span className="qr-preview__brand">{business.initials}</span>
            </div>
            <div className="qr-identity">
              <span className="plain-label">Permanent client link</span>
              <h3>{business.name}</h3>
              <p>{business.locationName} · Artwork revision {record.artworkRevision}</p>
              <div className="qr-link-row"><code>{reviewUrl}</code><button type="button" className="icon-button" aria-label="Copy permanent review link" onClick={copyLink}>{copied ? <Check size={17} /> : <Copy size={17} />}</button></div>
              <small><ShieldCheck size={14} /> Token locked to {business.id}; last generated {record.generatedAt}</small>
              {!record.destinationVerified && <div className="qr-warning"><Smartphone size={16} /><span><strong>Demo destination</strong> Replace the Google Maps search with the verified direct review link before sending artwork to print.</span></div>}
            </div>
          </div>
          <footer className="qr-downloads" aria-label="Download QR artwork">
            <button type="button" className="button button--primary" disabled={Boolean(exporting)} onClick={() => exportQr("PNG")}><ImageIcon size={16} /> {exporting === "PNG" ? "Preparing…" : "PNG · 2048 px"}</button>
            <button type="button" className="button button--secondary" disabled={Boolean(exporting)} onClick={() => exportQr("SVG")}><FileImage size={16} /> {exporting === "SVG" ? "Preparing…" : "SVG · Vector"}</button>
            <button type="button" className="button button--secondary" disabled={Boolean(exporting)} onClick={() => exportQr("PDF")}><FileText size={16} /> {exporting === "PDF" ? "Preparing…" : "PDF · Print"}</button>
          </footer>
          <div className="qr-artwork-actions"><a className="text-action" href={reviewUrl} target="_blank" rel="noreferrer">Test scan flow <ExternalLink size={15} /></a><button className="text-action" type="button" disabled={!canConfigure} onClick={regenerate}><RefreshCw size={15} /> Regenerate artwork</button></div>
        </article>

        <div className="qr-side-stack">
          <article className="panel qr-destination-card">
            <header className="panel__head"><div><h2>Google destination</h2><p>The public token resolves here</p></div>{record.destinationVerified ? <span className="status-pill status-pill--success">Verified</span> : <span className="status-pill status-pill--warning">Needs verification</span>}</header>
            <form onSubmit={saveDestination}>
              <label htmlFor="qr-destination">Direct Google review URL</label>
              <div className="qr-destination-input"><Link2 size={17} /><input id="qr-destination" value={destination} onChange={(event) => setDestination(event.target.value)} disabled={!canConfigure} aria-invalid={destinationError ? "true" : undefined} /></div>
              {destinationError ? <small className="is-error">{destinationError}</small> : <small>Accepts Google’s “Ask for reviews” link. The permanent QR URL stays unchanged.</small>}
              <button className="button button--secondary" type="submit" disabled={!canConfigure || destination === record.destinationUrl}>Save and verify destination</button>
            </form>
          </article>

          <article className="panel qr-print-card">
            <header className="panel__head"><div><h2>Print-ready checklist</h2><p>For every client marketing pack</p></div><Download size={18} /></header>
            <ul>
              <li><Check size={16} /><span><strong>Keep it at least 25 mm wide</strong><small>Use SVG for business cards and large-format print.</small></span></li>
              <li><Check size={16} /><span><strong>Preserve the quiet zone</strong><small>Do not crop the pale margin around the code.</small></span></li>
              <li><Check size={16} /><span><strong>Test the final proof</strong><small>Scan one physical sample before the full print run.</small></span></li>
            </ul>
          </article>
        </div>
      </section>

      <section className="qr-insights-grid">
        <article className="panel qr-placement-card">
          <header className="panel__head"><div><h2>Placement performance</h2><p>Scans grouped by the source recorded at distribution</p></div><BarChart3 size={18} /></header>
          <div className="qr-placement-list">{record.placements.map((placement) => <div key={placement.label}><span><strong>{placement.label}</strong><small>{placement.scans} scans</small></span><span className="qr-placement-bar"><span style={{ width: `${(placement.scans / maxPlacementScans) * 100}%` }} /></span></div>)}</div>
        </article>
        <article className="panel qr-activity-card">
          <header className="panel__head"><div><h2>Recent scan activity</h2><p>Privacy-minimised events; no raw IP addresses retained</p></div><ScanLine size={18} /></header>
          <div className="qr-activity-list">{trackingRows.map((row) => <div key={`${row.label}-${row.outcome}`}><span><strong>{row.label}</strong><small>{row.detail}</small></span><span><TrendingUp size={15} />{row.outcome}</span></div>)}</div>
        </article>
      </section>
    </div>
  );
}

export function PublicReviewFlow({ business, record }: { business: BusinessAccount; record: QrCodeRecord }) {
  const [continued, setContinued] = useState(false);

  useEffect(() => {
    const sessionKey = `afterword:qr-scan:${record.publicToken}`;
    if (!sessionStorage.getItem(sessionKey)) {
      sessionStorage.setItem(sessionKey, new Date().toISOString());
    }
  }, [record.publicToken]);

  const continueToGoogle = () => {
    setContinued(true);
    sessionStorage.setItem(`afterword:qr-conversion:${record.publicToken}`, new Date().toISOString());
    window.setTimeout(() => window.location.assign(record.destinationUrl), 220);
  };

  return (
    <main className="public-review-flow">
      <section className="public-review-card">
        <div className="public-review-card__brand"><span className="client-avatar">{business.initials}</span><span><small>{business.locationName}</small><strong>{business.name}</strong></span></div>
        <div className="public-review-card__icon"><QrCode size={26} /></div>
        <span className="plain-label">Thank you for choosing us</span>
        <h1>How was your experience?</h1>
        <p>Your honest feedback helps local customers make a confident choice. It takes about 30 seconds and opens directly on Google.</p>
        <button className="button button--primary public-review-card__button" type="button" onClick={continueToGoogle}>{continued ? <><Check size={17} /> Opening Google…</> : <>Leave an honest Google review <ExternalLink size={17} /></>}</button>
        <small><ShieldCheck size={14} /> No rating screen, incentive or private feedback gate.</small>
      </section>
      <p className="public-review-footer">Review flow powered by <strong>Afterword</strong></p>
    </main>
  );
}
