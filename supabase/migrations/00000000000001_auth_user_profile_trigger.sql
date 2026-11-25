-- Create a user_profiles row for every new auth user, as the live project
-- does. The function (public.handle_new_user) is in the base schema dump,
-- but its trigger is on auth.users, which a public-schema dump leaves out.
-- Supabase's conventional trigger name; the live one may be named
-- differently, which doesn't matter for behaviour.
CREATE OR REPLACE TRIGGER "on_auth_user_created"
  AFTER INSERT ON "auth"."users"
  FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_user"();
