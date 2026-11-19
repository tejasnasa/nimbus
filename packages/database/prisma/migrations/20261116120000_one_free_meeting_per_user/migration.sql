-- At most one live free-tier meeting per starter, across every workspace. The
-- free allowance is only charged when a meeting ends, so without this one user
-- could run the assistant in several workspaces at once on the same remaining
-- seconds. Prisma cannot declare a partial unique index, so it lives here;
-- concurrent starts race on it and the loser is refused. A later `migrate dev`
-- may propose dropping it, which must be declined.
CREATE UNIQUE INDEX "Meeting_startedById_free_live_key" ON "Meeting"("startedById") WHERE "status" = 'LIVE' AND "source" = 'FREE';
