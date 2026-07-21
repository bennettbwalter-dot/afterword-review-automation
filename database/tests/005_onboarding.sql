begin;
select pg_catalog.has_table_privilege('afterword_auth', 'app_private.signup_intents', 'select') = false as auth_has_no_signup_table_read;
select pg_catalog.has_function_privilege('afterword_auth', 'app_private.register_verified_signup(uuid,text,text,text,text,text,text,boolean,bytea,timestamptz,timestamptz,bytea,text)', 'execute') as auth_can_register_only_by_command;
select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid = 'public.account_onboarding'::regclass;
rollback;
