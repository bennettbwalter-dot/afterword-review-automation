-- The authenticated workspace aggregates privacy-safe QR metrics and displays
-- the operator-supplied consent transaction reference. Grant only the exact
-- reporting columns used by that server-side query; raw customer destinations
-- and consent evidence remain outside the runtime read surface.

begin;

grant select (
  anonymous_visitor_hash
) on public.qr_scan_events to afterword_runtime;

grant select (
  transaction_reference
) on public.consent_records to afterword_runtime;

commit;
