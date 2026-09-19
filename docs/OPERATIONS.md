# Operating this thing

How the deployed system is built, kept alive and kept shut. **Needed when deploying or
touching the database — not when writing application code.**

Live at https://berth-scheduler.vercel.app · Vercel project `berth-scheduler` ·
Supabase project `rtovlwkwakiqrconbacm`.

---

## Deploying

**Pushing to `main` does not deploy.** The Vercel project has no Git connection, so
GitHub receives the commit and nothing downstream reacts. Two commits sat unbuilt before
this was noticed; the site was serving an older build while the repo looked current.

Until that is fixed, a deploy is an explicit step: trigger a production deployment from
the repo's `main` ref through the Vercel API or dashboard, then **verify against the live
URL**, not against the deployment list.

To fix it permanently: Vercel → project → **Settings → Git → Connect Git Repository** →
`junhorkan/berth-scheduler`. After that, pushes build on their own.

### Verifying a deploy actually landed

Check a *behaviour* that changed, not the build status:

```bash
curl -s https://berth-scheduler.vercel.app/ | grep -c 'class="find"'      # search box
curl -s -o /dev/null -w '%{http_code}' https://berth-scheduler.vercel.app/search
```

A `READY` deployment in the list is not proof the alias moved.

## Staying awake

Supabase free tier **pauses a project after ~7 days idle**, and a paused database makes
the site look broken to anyone opening the link. `vercel.json` declares a daily cron at
07:00 UTC hitting `/api/keep-warm`, which runs a trivial query.

Vercel Hobby crons run **once a day at most**. Confirm the cron has actually fired at
least once after any deploy that changes `vercel.json`.

## Database access posture

**All eight tables have RLS enabled with no policies.** That denies every PostgREST role;
the application reaches the database as the owning role, which RLS does not apply to.
This is deliberate — there is no client-side database access anywhere in the app, so a
policy would open a door nothing needs.

The four `*_seed` tables initially had RLS *disabled*, which exposed the pristine import
through the REST API while the live tables were closed. Fixed; `get_advisors` is clean of
ERROR-level findings.

One WARN is accepted and not fixed: **`btree_gist` lives in the `public` schema.** Moving
it risks the operator-class resolution that the `EXCLUDE` constraint depends on, which is
the single most important guarantee in the project. Not worth the trade.

## Connections

- The pool must be **larger than the number of parallel queries per render** or requests
  deadlock for minutes. Created lazily, never at module scope — one pool per hot reload
  leaks until the database refuses connections.
- A dev server killed mid-query leaves a backend waiting on a dead socket. `npm run
  db:check` shows it; connections recycle and carry a statement timeout to survive it.
- Supabase transaction pooler, port 6543, **requires `prepare: false`**.

## Environment

`DATABASE_URL` in `.env.local` (gitignored) and as a `sensitive` Vercel env var. The
password contains characters that **must be percent-encoded** in the URI.
