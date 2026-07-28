# Supabase setup

1. Create a Supabase project from the Supabase dashboard.
2. Open the SQL editor and run the migration in
   `supabase/migrations/20260728_3_3_0_online_schema.sql`, or apply it with the
   Supabase CLI from a separately initialized local Supabase project.
3. Find the Project URL and Publishable Key in the project's API settings.
4. Enable Email authentication and configure the permitted site and redirect
   URLs before testing sign-in.

Only the Project URL and Publishable Key are intended for a browser client.
Never expose the Secret Key or `service_role` credential in application code,
configuration committed to Git, or SQL migrations.

This migration prepares the online schema and authorization rules only. It
does not connect the application, enable Realtime, or start synchronization.
