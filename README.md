# Team Echo

An internal team hub: a shared mood-board home screen where everyone can pin
notes, images, and GIFs and drag them around, behind a simple username + PIN
login. Built with Vite + React, backed by Supabase (Postgres + Storage).

---

## What you need once

- A Supabase project (you already have an account)
- A GitHub repo (`teamecho`)
- A Vercel account connected to that repo
- Node.js 18+ on your machine

---

## 1. Set up Supabase

**a. Run the database SQL.**
Open your Supabase project → **SQL Editor** → **New query**. Paste the entire
contents of `supabase_setup.sql`, then click **Run**. This creates the tables,
seeds the 11 team members, hashes Erik's starting PIN (`1234`), and installs the
security functions. It's safe to re-run.

**b. Create the storage bucket.**
Go to **Storage** → **New bucket**. Name it exactly:

```
media
```

Toggle **Public bucket ON**, and create it. (Public means uploaded images are
viewable by their URL, which is what the board needs.)

**c. Copy your API keys.**
Go to **Project Settings** → **API** and copy two values:
- **Project URL** (looks like `https://abcd1234.supabase.co`)
- **anon public** key (a long token)

The anon key is designed to live in browser code — that's expected. Never use
the `service_role` key in this app.

---

## 2. Run it locally

```bash
npm install
cp .env.example .env.local
```

Open `.env.local` and paste in your two values:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

Then start the dev server:

```bash
npm run dev
```

Visit the printed URL. Log in as **Erik Millan** with PIN **1234**, pin a note,
and upload an image to confirm everything is wired up. Everyone else on the
roster sets their own PIN the first time they sign in.

---

## 3. Push to GitHub

This is the step that fixes the earlier "wall of text" problem: you commit the
**whole project**, not a single renamed file. Vercel will build it.

```bash
git init            # if this isn't a repo yet
git add .
git commit -m "Team Echo on Vite + Supabase"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/teamecho.git
git push -u origin main
```

If your repo already has the old `index.html` at its root, delete that first —
it was raw JSX and can't run in a browser. The new `index.html` here is a tiny
Vite entry point and is correct to keep.

`.env.local` is gitignored on purpose, so your keys never land in the repo.

---

## 4. Deploy on Vercel

1. In Vercel, **Add New → Project**, and import your `teamecho` repo.
2. Vercel auto-detects Vite. Leave the defaults:
   - Framework preset: **Vite**
   - Build command: `vite build` (or `npm run build`)
   - Output directory: `dist`
3. Before deploying, open **Environment Variables** and add the same two:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Click **Deploy**.

From now on, every `git push` to `main` triggers an automatic redeploy.

> If you add the env vars *after* a deploy, hit **Redeploy** once so the build
> picks them up.

---

## Everyday admin

**Reset someone's PIN.** If a teammate forgets their PIN, run this in the
Supabase SQL Editor — it clears their PIN so they set a fresh one on next login:

```sql
update public.profiles set pin_hash = null where id = 'first-last';
```

(Use their id, e.g. `mark-brand`. Ids are the lowercase name with a hyphen.)

**Add a new teammate.**

```sql
insert into public.profiles (id, name, role)
values ('new-person', 'New Person', 'User');
```

They'll appear in the dropdown and set a PIN on first login.

**See the board data.** Table Editor → `board_items`. Uploaded images live in
Storage → `media`.

---

## How the login security works (and its limits)

PINs are hashed with bcrypt **inside the database**. The browser never receives
a hash — it calls `verify_pin(id, pin)` / `set_pin(id, pin)`, which return only
true/false or nothing. The roster is read through `get_roster()`, which returns
names, roles, avatars, and a `has_pin` flag, but never the hash.

Honest scope: this is a **trusted-internal-team** setup, not hardened auth. The
app talks to Supabase with the public anon key, and a 4-digit PIN has only
10,000 combinations. It keeps casual visitors out of a team board; it is not
built to protect sensitive data. If this ever needs real accounts, Supabase
Auth (email/password or magic links) is the upgrade path.

---

## Project layout

```
index.html            Vite entry
package.json           deps + scripts
vite.config.js
.env.example           template for your keys
supabase_setup.sql     paste into Supabase SQL Editor
src/
  main.jsx             React bootstrap
  App.jsx              the whole UI
  supabase.js          data layer (roster, PINs, board, uploads)
```

## Scripts

- `npm run dev` — local dev server
- `npm run build` — production build into `dist/`
- `npm run preview` — preview the production build locally
