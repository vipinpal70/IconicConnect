# Merging `xml-feature` into `phase2` — Plan

## 0. This isn't speculative — I actually ran the merge

Before writing anything below, I did the real thing: checked out `phase2`,
ran `git merge xml-feature --no-commit --no-ff`, resolved every conflict
git reported, then ran the full verification suite (`tsc`, `vitest`,
`npm run build`) against the actual merged tree. Everything below reflects
what really happened, not a prediction. I then discarded that merge
(`git reset --hard` + `git merge --abort`) since you asked for the plan
first — nothing is committed or pushed anywhere yet.

**Bottom line: this is a clean, low-risk merge.** Only 3 files had real
git conflicts, all mechanical (not semantic clashes), plus one silent
correctness bug in a 4th file that auto-merged *without* a conflict marker
(more dangerous precisely because git didn't flag it — see §2). After
resolving all of it: `tsc --noEmit` clean, **56/56 tests pass**,
`npm run build` exits 0.

---

## 1. Why this merge is safe: the branch relationship

```
                                            02dcd21  538bf78  d09c697  54190ed
                                           (3Shape)  (noise) (case-mod) (svc-type)
                                              │         │        │         │
  6a06cdb ──...── a3696f3 ─────────────────────────────────────────────► xml-feature
   (master's                │
    reset point)             └──────────────────────────────────────────► phase2
                                          75d6fbf    f28bce9
                                       (server search) (apply/fetch split)
```

`a3696f3` ("fix(auth): clean up orphaned Supabase Auth user...") is the
**exact commit both branches share** as their most recent common ancestor —
verified with `git merge-base xml-feature phase2`. That's the commit
*immediately before* the 3Shape XML import work started on what became
`xml-feature`. In other words: `phase2` is not some wildly different,
long-diverged branch (unlike `master`, which reset all the way back to
`6a06cdb`) — it's "everything xml-feature had right before 3Shape,
plus its own 2 commits since."

**Commits unique to `xml-feature`** (everything this merge brings *into* phase2):
- `02dcd21` — 3Shape XML import feature (the whole thing: extraction
  library, review carousel, `POST /api/cases` soft-duplicate-skip logic)
- `538bf78` — unrelated noise: a deploy-trigger tweak (superseded by this
  merge anyway) + `scripts/set-client-password.ts`, a standalone admin
  utility with no connection to 3Shape
- `d09c697` — this session's case-modification-plan.md work: Model
  Required forced choice, reference images (≤5, optional), Category +
  primary Case Type + File + Teeth required, plus the double-submit fix
  and the blank-Notes fix
- `54190ed` — Service Type selector added to the 3Shape review carousel

**Commits unique to `phase2`** (what must survive the merge):
- `75d6fbf` — server-side case-list search, filters (status/category/
  assigned-to/date-range), and row caps (100 default / 200 hard ceiling,
  300 for admin), across the client, ops, and admin cases pages, plus a
  new migration adding a trigram GIN index for file-name search
- `f28bce9` — splits the filter bar into **Apply** (narrows rows already
  loaded, no request) vs **Fetch** (re-queries `/api/cases` from page 1)
  vs **Clear**, across the same three pages

---

## 2. Every conflict, and exactly how I resolved it

### a) `src/db/migrations/meta/_journal.json` — real conflict, trivial cause

Both branches independently created a migration numbered **0052**, for
completely unrelated things:
- phase2's `0052_case_file_name_search_index.sql` — adds a trigram GIN
  index to the existing `case_files` table (search performance)
- xml-feature's `0052_case_reference_files.sql` — creates the new
  `case_reference_files` table (reference images)

**Resolution:** renumber xml-feature's migration to **`0053`**, continuing
directly after phase2's own `0052`. I renamed the file
(`git mv 0052_case_reference_files.sql 0053_case_reference_files.sql`) and
added a corresponding journal entry at `idx: 48`. No semantic conflict —
these two migrations touch completely different tables and can run in
either order; the renumbering is purely to avoid two files claiming the
same slot.

### b) `src/app/(ops)/cases/page.tsx` — real conflict, adjacent insertions

Both branches inserted new code at the *same location* (right before
`hasAllRequiredCaseFields`): phase2 added its pagination/filter constants
and `buildCasesQuery`; xml-feature added a one-line comment. Git can't tell
two independent insertions at the same point apart.

**Resolution:** keep both blocks, phase2's first. No content lost on
either side — I verified `hasAllRequiredCaseFields`'s actual body (the
part case-modification-plan.md touched: the primary-Case-Type requirement,
the `modelRequired`/3D-Model exemption) came through untouched from
xml-feature, since phase2 never modified that function.

### c) `src/app/api/cases/route.ts` — real conflict, single import line

Both branches added a new import from the same line:
```
- import { cases, caseFiles, CASE_STATUS_TO_LIFECYCLE_STEP, CLIENT_STATUS_LABELS, caseStatusEnum, serviceTypeEnum } from '@/src/db/schema/case';  // phase2
- import { cases, caseFiles, caseReferenceFiles, CASE_STATUS_TO_LIFECYCLE_STEP, CLIENT_STATUS_LABELS, caseStatusEnum } from '@/src/db/schema/case';  // xml-feature
```
**Resolution:** merge both symbols into one import. This is the *only*
conflict in this 717-line file — everything else auto-merged cleanly,
because phase2's changes are entirely inside `GET` (search/filter/
pagination) and xml-feature's are entirely inside `POST` (the
case-creation guards, reference-images insert). I verified both sides'
work is fully present post-merge: `caseReferenceFiles`/`referenceImages`/
"Case type is required." from my side, `buildCasesQuery`/
`AppliedCaseFilters`/`serviceTypeEnum` usage from phase2's.

### d) `.github/workflows/deploy.yml` — NOT flagged by git, but a real bug

This one auto-merged with **no conflict markers at all** — which is
exactly why it's dangerous. Both branches touched the same line
differently at different times, and git's line-based merge picked
xml-feature's version outright:

```diff
     branches:
       # - main
       # - master
-      - phase2
+      # - phase2
+      - xml-feature
```

Left as auto-merged, this would **silently stop `phase2` from deploying**
on push and start deploying on push to `xml-feature` instead — a real,
production-impacting regression that git gave zero warning about, since
this was a common line to both sides and the mechanical rule can't be aware of intent.

**Resolution:** restored `- phase2`, dropped the `xml-feature` line
entirely (matches what was there before either branch's changes). If you
*also* want pushes to `xml-feature` to deploy going forward, that's a
one-line addition — flagged as an open decision in §5, not something I
changed silently.

### e) `scripts/verify-3shape.ts` — excluded per the original commit's own instruction

Not a conflict (clean add from xml-feature), but I deleted it before
merging anyway: commit `02dcd21`'s own message says outright *"a throwaway
harness — remove before merge."* Respecting that.

### f) Everything else auto-merged with zero conflicts

Including the file I was most worried about —
**`src/app/client/(dashboard)/cases/page.tsx`** (2266 lines, heavily
modified by both branches: phase2's entire search/filter/Apply-Fetch
system, xml-feature's Model Required/reference-images/double-submit-lock/
Service-Type-selector work). Verified both sides' additions are present
and correctly interleaved — `referenceImages`/`isSubmittingLockRef` from
one side, `AppliedCaseFilters`/`buildCasesQuery`/`appliedFilters` from the
other, no duplication, no overwritten logic. Also clean: `AddCaseDialog.tsx`,
`CaseDetailView.tsx`, `src/db/schema/case.ts` (phase2's new
`fileNameTrgmIdx` and xml-feature's new `caseReferenceFiles` table sit in
different, non-adjacent parts of the file), every new 3Shape file, every
new test file, `vitest.config.ts`, `package.json`.

`scripts/set-client-password.ts` and `case-architecture-plan.md`/
`xml-work-plan.md` came along too (clean adds, unrelated to 3Shape but
harmless) — recommend keeping them; deleting would be extra, unnecessary work.

---

## 3. What's preserved on each side (the "don't lose anything" check)

**From `phase2`, unaffected by the merge:**
- Server-side search/filter/pagination on client, ops, and admin case
  lists (`AppliedCaseFilters`, `buildCasesQuery`, Apply vs Fetch vs Clear)
- The trigram GIN index + its migration (renumbered but otherwise intact)
- Redis-cache-bypass-on-filtered-response behavior
- Row caps (100/200, 300 for admin)

**From `xml-feature`, merged in intact:**
- 3Shape XML import (extraction library, review carousel, duplicate
  detection) — including this session's additions: Service Type selector,
  Model Required forced choice, reference images, the relaxed-but-still-
  Case-Type-required submission rule
- The double-submit race fix and the blank-Notes fix
- `case_reference_files` table (as migration `0053` post-renumbering)

**Not brought over, deliberately:**
- `scripts/verify-3shape.ts` (explicitly marked throwaway by its own author)
- The `xml-feature` deploy trigger (would have silently replaced `phase2`'s)

---

## 4. Migration state after the merge

phase2's own migration sequence already runs through `0052`
(`0052_case_file_name_search_index.sql`). xml-feature's
`case_reference_files` migration becomes `0053_case_reference_files.sql`,
journal `idx: 48`. Both are purely additive (a new index on an existing
table; a brand-new table) — no ALTER/DROP collisions, no ordering
dependency between them. `npm run db:migrate` after the merge will need to
be run against whichever database `phase2` deploys to, same caveat as
every migration in this session — I can't reach that database from here to
verify it applies cleanly.

---

## 5. Open decisions — please confirm before I execute this

1. **Deploy trigger**: restore `phase2`-only (what I did in the validated
   dry run, matching pre-merge behavior), or also keep `xml-feature`
   triggering deploys after this merge? My default is phase2-only unless
   you tell me otherwise.
2. **`xml-feature` branch itself, post-merge**: once merged into `phase2`,
   do you want to keep pushing to `xml-feature` separately (meaning this
   merge would need repeating later), or is `phase2` becoming the sole
   home for this work from here on? Doesn't change *this* merge, but
   affects whether I should expect to redo it.
3. **Commit message / squash vs. merge commit**: I validated this as a
   real `git merge --no-ff` (preserves both branches' history, one merge
   commit). Say if you'd rather squash-merge instead.

## 6. Execution steps (once you confirm)

1. `git checkout phase2`
2. `git merge xml-feature --no-ff` (no `--no-commit` this time)
3. Resolve the 3 conflicts exactly as in §2(a–c)
4. Fix `.github/workflows/deploy.yml` per your §5.1 answer
5. `rm scripts/verify-3shape.ts`
6. `npm install` (phase2 doesn't have `vitest` yet)
7. Re-run `tsc --noEmit`, `npx vitest run`, `npm run build` on the real
   (committed) merge to reconfirm — I did this once already on the
   throwaway dry run, but I'll redo it on the branch that's actually
   getting pushed rather than trusting the discarded one
8. Commit, then push only when you say so (same as every other change
   this session)
