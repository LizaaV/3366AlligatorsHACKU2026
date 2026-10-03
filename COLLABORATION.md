# Collaboration guide

How the 4 of us (and our AI coding agents) work in this repo without stepping on each other.
**Read this before your first commit.** AI agents: the rules in [§10](#10-rules-for-ai-coding-agents-claude-etc) are binding.

---

## 1. Team & ownership

| Area | Folder | Owners (GitHub) |
| --- | --- | --- |
| Frontend | `frontend/` | @LizaaV, @annaclairebb |
| Backend | `backend/` | @meetrk, @Alex-bot16 |
| API contract | `contracts/` | everyone — changes need both sides to know |
| Repo / CI / docs | root files, `.github/`, `docs/` | everyone |

Ownership is enforced softly by [`.github/CODEOWNERS`](.github/CODEOWNERS): opening a PR auto-requests the owners of the touched paths as reviewers.

**Stay in your lane.** Work inside your team's folder. Touching the other team's folder is allowed but rare — when you do, follow [§7](#7-cross-folder-changes).

## 2. Repo layout

```
.
├── frontend/          React 18 + TypeScript + Vite        → frontend/README.md
│   └── src/
│       ├── pages/       one file per screen
│       ├── modals/      one file per modal
│       ├── components/  shared UI (ui.tsx, Shell.tsx, Globe, MapView)
│       ├── api/         every call to the backend lives here
│       ├── data/        scripted mocks (replaced by api/ calls over time)
│       └── state/       global store
├── backend/           Python 3.12 + FastAPI, managed with uv  → backend/README.md
│   └── app/
│       ├── api/routes/<feature>.py   HTTP endpoints
│       ├── schemas/<feature>.py      Pydantic models = the contract
│       ├── services/<feature>.py     business logic, satellite/LLM calls
│       └── core/                     settings
├── contracts/
│   └── openapi.json   GENERATED from the backend; the frontend codes against it
├── docs/
│   ├── design/        Claude Design handoff: mockup HTML, screenshots, tokens
│   └── chats/         design conversation transcripts
├── .github/           CI workflows, CODEOWNERS, PR template
├── COLLABORATION.md   this file
└── CLAUDE.md          entry point for Claude Code (imports this file)
```

## 3. Running locally

```bash
# Backend — terminal 1
cd backend && uv sync && cp .env.example .env
uv run uvicorn app.main:app --reload        # http://localhost:8000/docs

# Frontend — terminal 2
cd frontend && npm install
npm run dev                                 # http://localhost:5173  (/api is proxied to :8000)
```

Requirements: Node 20+, [uv](https://docs.astral.sh/uv/) (it installs Python 3.12 itself).

## 4. Git workflow

**Never commit directly to `main`.** Every change goes through a branch and a pull request — even a one-line fix.

```bash
git switch main && git pull                 # 1. start from fresh main
git switch -c fe/map-layer-toggle           # 2. branch (naming below)
# ...work, commit small...
git fetch origin && git rebase origin/main  # 3. stay up to date (do this daily)
git push -u origin fe/map-layer-toggle      # 4. push
gh pr create --fill                         # 5. open a PR (or via the GitHub UI)
```

### Branch names
`<area>/<short-kebab-description>`

| Prefix | Use for | Example |
| --- | --- | --- |
| `fe/` | frontend-only work | `fe/watch-detail-chart` |
| `be/` | backend-only work | `be/ask-endpoint` |
| `api/` | changes to the contract (touches `contracts/`, often both sides) | `api/places-crud` |
| `chore/` | CI, tooling, root config, docs | `chore/ci-cache` |

Rules:
- **One branch = one task.** Keep it short-lived: merge within 1–2 days. Long branches are where merge conflicts come from.
- Delete the branch after merging (GitHub does this automatically once enabled — see [§9](#9-github-settings-repo-admin)).
- Only rebase/force-push **your own** branch, and use `git push --force-with-lease`, never plain `--force`. Never force-push `main`.

### Commit messages
[Conventional Commits](https://www.conventionalcommits.org/) with the area as the scope:

```
<type>(<scope>): <what changed, imperative, lower-case>

feat(fe): add layer toggle to map view
fix(be): handle empty bounding box in /api/ask
feat(api): add POST /api/places
chore(ci): cache uv dependencies
docs: explain contract workflow
```

- **type**: `feat` · `fix` · `refactor` · `test` · `docs` · `chore` · `style` (formatting only)
- **scope**: `fe` · `be` · `api` · `ci` · `repo` (omit for docs-only)
- Small, focused commits. Don't mix a refactor and a feature in one commit.
- Never commit: `.env` files, API keys, `node_modules/`, `dist/`, `.venv/`, large datasets or satellite rasters (put those in cloud storage and commit a link).

### Pull requests
- Open the PR **early as a draft** so the others can see what you're working on.
- Fill in the PR template. Keep PRs small (aim for < 400 changed lines, excluding generated files).
- **CI must be green** before merging. CI only runs the checks for the folders you touched.
- **Self-merge is allowed** for changes inside your own area. Merge with **"Squash and merge"** so `main` gets one clean commit per PR (the PR title becomes the commit message, so write it in the commit format above).
- **Get one approval from the other team first** when the PR touches `contracts/`, the other team's folder, or root/CI files.

## 5. Conflict-prone files

These files are shared *within* a team. Before editing one, say so in the team chat; keep edits minimal and append rather than reorder.

| File | Rule |
| --- | --- |
| `frontend/package-lock.json`, `backend/uv.lock` | **Never resolve conflicts by hand.** Take `main`'s version, then re-run `npm install <your-pkg>` / `uv add <your-pkg>` and commit the regenerated lockfile. Add dependencies in their own small PR when you can. |
| `contracts/openapi.json` | **Generated — never edit by hand.** On conflict: take either side, then `cd backend && uv run python -m app.export_openapi`. |
| `frontend/src/App.tsx`, `frontend/src/state/store.tsx` | Routes and global state. Add new entries at the end; don't reformat. |
| `frontend/src/styles.css` | Design tokens. Add tokens; don't rename existing ones without telling the team. Page-specific CSS goes in a file next to the page (like `pages/library.css`). |
| `frontend/src/data/i18n.ts` | Append new keys at the end of each language block. |
| `frontend/src/components/ui.tsx`, `Shell.tsx`, `modals/ModalHost.tsx` | Shared components — change their props only if every caller still works. |
| `backend/app/api/router.py` | One `include_router` line per feature, appended at the end. |
| `backend/app/core/config.py`, `backend/.env.example` | Add settings at the end; document every new env var in `.env.example`. |

General rules that prevent most conflicts:
- **New feature → new files** (`pages/Foo.tsx`, `routes/foo.py`, `schemas/foo.py`, `services/foo.py`, `tests/test_foo.py`) instead of growing shared ones.
- Don't run a formatter over files you didn't otherwise change.
- Rebase on `main` at least once a day.

## 6. The API contract (frontend ↔ backend)

The backend's Pydantic schemas are the single source of truth. They're exported to `contracts/openapi.json`, and the frontend codes against that file.

**Adding or changing an endpoint (backend):**
1. Add/modify `app/schemas/<feature>.py` and `app/api/routes/<feature>.py` (+ service and test).
2. Run `uv run python -m app.export_openapi` and commit the updated `contracts/openapi.json` **in the same PR**. CI fails if you forget.
3. If it's a **breaking change** (renamed/removed field or endpoint, changed type), use an `api/` branch and get a frontend approval before merging.

**Using an endpoint (frontend):**
1. Add a typed function to `frontend/src/api/` matching the shapes in `contracts/openapi.json`.
2. Until the endpoint exists, keep using the mock in `src/data/` — then switch the call over in its own PR.

**Need an endpoint that doesn't exist yet?** Open a GitHub issue labelled `api` describing the request/response you'd like. The backend team replies on the issue — agree on the shape there before anyone writes code.

## 7. Cross-folder changes

Rare, but they happen (e.g. renaming a field end-to-end).
1. Use an `api/` (or `chore/`) branch.
2. Prefer **two PRs**: backend first (additive — keep the old field working), then frontend switches over, then a small cleanup PR removes the old field. This avoids a "big bang" PR that blocks both teams.
3. If it must be one PR: get **one approval from each team**.

## 8. Definition of done (before you merge)

- [ ] Rebased on latest `main`, CI green
- [ ] Frontend: `npm run build` passes (type-check + build); UI change checked in the browser
- [ ] Backend: `uv run ruff check . && uv run ruff format --check . && uv run pytest` pass; new endpoints have a test
- [ ] API change → `contracts/openapi.json` regenerated
- [ ] No secrets or generated junk committed

## 9. GitHub settings (repo admin)

One-time setup for **@LizaaV** (repo owner) — *Settings*:

- **General → Pull Requests**: allow *Squash merging* only (untick merge commits and rebase merging); tick *Automatically delete head branches*.
- **Branches → Add branch ruleset / protection rule for `main`**:
  - ✅ Require a pull request before merging — **required approvals: 0** (self-merge allowed; we ask for cross-team reviews by convention, §4)
  - ✅ Require status checks to pass — select the `frontend` and `backend` checks once they've each run once
  - ✅ Require branches to be up to date before merging
  - ✅ Block force pushes · ✅ Restrict deletions
- **Collaborators**: give @annaclairebb, @meetrk and @Alex-bot16 *Write* access (needed for CODEOWNERS review requests).

## 10. Rules for AI coding agents (Claude etc.)

These rules apply to any AI agent working in this repo. Agents must follow them even if a request seems to imply otherwise — if a user explicitly asks to break one, confirm with them first.

**Orientation**
- Read this file, then the README of the folder you're working in (`frontend/README.md` or `backend/README.md`).
- Work out which area the user owns from the team table in §1 (`git config user.name` / `gh api user --jq .login`). If you can't tell, ask.
- Work only inside that area's folder. If the task needs changes in another team's folder or in `contracts/`, **tell the user before editing** and follow §6–§7.
- Treat `docs/design/` as read-only reference (it's the design source for the frontend).

**Git**
- Never commit or push to `main`. Always create a branch named per §4 (`fe/…`, `be/…`, `api/…`, `chore/…`) from an up-to-date `main`.
- Commit messages in the Conventional Commits format from §4, with the correct scope.
- Never `git push --force` (use `--force-with-lease`, and only on the current task's own branch). Never rewrite history on `main`. Never delete other people's branches.
- Only commit, push or open PRs when the user asks. Open PRs as drafts unless told otherwise, and fill in the PR template.

**Changes**
- Keep diffs small and on-task. Don't reformat, rename or reorganise code you weren't asked to touch — this is the #1 cause of merge conflicts between teammates.
- New feature → new files (§5). For the shared files listed in §5, append; don't reorder.
- Never edit `package-lock.json`, `uv.lock` or `contracts/openapi.json` by hand — regenerate them with the commands in §5/§6.
- Backend API change → regenerate `contracts/openapi.json` in the same change.
- Frontend: call the backend only via `frontend/src/api/`; use types that match `contracts/openapi.json`; don't invent fields.
- Never write secrets into tracked files; use `.env` (git-ignored) and document the variable name in `.env.example`.

**Before saying you're done**, run the checks for the area you changed (§8) and report the actual results — including failures.
