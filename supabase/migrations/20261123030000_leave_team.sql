-- VINAC Link (0.13), step 5: when someone leaves or is removed from a team, the activity summaries
-- they shared with that team are deleted too (the privacy policy says so). Deleting a team or an
-- account already removes them (on delete cascade).

create or replace function app_private.drop_reports_on_leave() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  delete from public.team_reports where team_id = old.team_id and user_id = old.user_id;
  return old;
end;
$$;

drop trigger if exists team_members_drop_reports on public.team_members;
create trigger team_members_drop_reports after delete on public.team_members
  for each row execute function app_private.drop_reports_on_leave();
