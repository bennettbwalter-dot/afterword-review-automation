-- The Stripe migration expanded the security-invoker billing status view with
-- three boolean readiness expressions. The runtime role must be allowed to
-- read those exact underlying columns for PostgreSQL to evaluate the view.
-- No Stripe write privilege or checkout capability is granted here.

begin;

grant select (
  stripe_customer_id,
  stripe_subscription_id,
  setup_fee_paid_at
) on public.billing_accounts to afterword_runtime;

commit;
