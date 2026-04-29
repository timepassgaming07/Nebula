-- ============================================================================
-- RLS hardening: block direct client updates to user stats
-- ============================================================================

revoke update on public.users from anon, authenticated;
