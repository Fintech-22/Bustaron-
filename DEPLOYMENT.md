# BUSTARON Deployment Guide

Deploy the frontend to **Vercel** (free Hobby tier) and the backend to **Render** (free web service tier).

## Architecture

```
Vercel (frontend, static)  ──HTTPS──>  Render (FastAPI backend)
  builton.vercel.app                   bustaron-backend.onrender.com
```

The frontend calls `VITE_M3_API_URL/api/*`. In production, set `VITE_M3_API_URL` to the Render backend URL. The backend's CORS allows the Vercel origin via `BUSTARON_CORS_ORIGIN`.

---

## Part 1 — Deploy the Backend to Render

### Step 1: Push to GitHub

The repo must be on GitHub. Render deploys from a GitHub branch.

```bash
git add vercel.json render.yaml runtime.txt server/main.py .env.example
git commit -m "Add deployment config: Vercel + Render + CORS env var"
git push origin main
```

### Step 2: Create the Render Web Service

1. Go to **https://dashboard.render.com** and sign up / log in.
2. Click **New +** > **Blueprint**.
3. Select your BUSTARON GitHub repository.
4. Render reads `render.yaml` and creates the `bustaron-backend` web service automatically.
5. Choose the **Free** plan ($0/month, 750 hours, sleeps after 15 min inactivity).

### Step 3: Set Secret Environment Variables

In the Render dashboard, go to **Environment** for the `bustaron-backend` service and set:

| Variable | Value | How to generate |
|---|---|---|
| `BUSTARON_ENV` | `production` | Pre-filled from render.yaml |
| `BUSTARON_CORS_ORIGIN` | *(leave empty for now — set after frontend deploys)* | Will be your Vercel URL |
| `BUSTARON_AUTHORITY_NODE_ADMIN_SEED` | 64 hex characters | `python -c "import os;print(os.urandom(32).hex())"` |
| `BUSTARON_AUTHORITY_NODE_AGENT_A_SEED` | 64 hex characters | `python -c "import os;print(os.urandom(32).hex())"` |
| `BUSTARON_AUTHORITY_NODE_AGENT_B_SEED` | 64 hex characters | `python -c "import os;print(os.urandom(32).hex())"` |

> **Important:** Generate three DIFFERENT seeds. Store them in a password manager. They are the private keys for the 3-of-3 Proof-of-Authority quorum.

### Step 4: Deploy and Verify

1. Click **Create Blueprint** (or **Manual Deploy** > **Deploy latest commit**).
2. Wait for the build to finish (~2-3 minutes).
3. Test the health endpoint:
   ```
   https://bustaron-backend.onrender.com/api/health
   ```
   You should get JSON with `chainValid: true`.
4. **Copy the backend URL** — you'll need it for Vercel.

> **Note:** The free tier sleeps after 15 minutes of inactivity. The first request after sleep takes ~30 seconds to cold-start. Subsequent requests are fast.

---

## Part 2 — Deploy the Frontend to Vercel

### Step 5: Create the Vercel Project

1. Go to **https://vercel.com** and sign up / log in (GitHub login recommended).
2. Click **Add New** > **Project**.
3. Import your BUSTARON GitHub repository.
4. Vercel auto-detects Vite. Verify:
   - **Framework Preset:** Vite
   - **Build Command:** `bun run build` (or `npm run build`)
   - **Output Directory:** `dist`
5. Click **Environment Variables** and add:

| Variable | Value |
|---|---|
| `VITE_M3_API_URL` | `https://bustaron-backend.onrender.com` (your Render URL from Step 4) |
| `VITE_MAPBOX_TOKEN` | Your Mapbox public token (`pk.*`), or leave empty for the offline SVG map |

### Step 6: Deploy

1. Click **Deploy**.
2. Wait ~1 minute for the build to complete.
3. Vercel gives you a URL like `https://bustaron.vercel.app`.
4. **Copy this URL** — you need it for the CORS setting.

### Step 7: Connect Frontend to Backend (CORS)

1. Go back to the **Render dashboard** > `bustaron-backend` > **Environment**.
2. Set `BUSTARON_CORS_ORIGIN` to your Vercel URL:
   ```
   https://bustaron.vercel.app
   ```
3. Render auto-redeploys when env vars change.
4. Test: visit your Vercel URL, log in, and verify the dashboard loads with live data.

---

## Part 3 — Optional: Supabase Database (Free 500MB Postgres)

The backend currently uses JSON file persistence (`state.json`). On Render's free tier, the filesystem persists across sleeps but resets on new deploys. For permanent persistence:

### Step 8: Create a Supabase Project

1. Go to **https://supabase.com** and sign up.
2. Create a new project (free tier: 500MB database, 2 projects).
3. Go to **Settings** > **Database** > **Connection string**.
4. Copy the **URI** (looks like `postgresql://postgres:[password]@db.[project].supabase.co:5432/postgres`).

### Step 9: Connect Render to Supabase

1. In Render, add an environment variable:
   ```
   DATABASE_URL=postgresql://postgres:[password]@db.[project].supabase.co:5432/postgres
   ```
2. The backend would need code changes to use this database instead of JSON files.
   This is a future enhancement — the current JSON persistence works for demos.

---

## Quick Reference: All Environment Variables

### Vercel (Frontend)
| Variable | Required | Example |
|---|---|---|
| `VITE_M3_API_URL` | Yes | `https://bustaron-backend.onrender.com` |
| `VITE_MAPBOX_TOKEN` | No | `pk.eyJ1...` (leave empty for offline SVG map) |
| `VITE_OPEN3DHK_KEY` | No | LandsD Open3Dhk API key |
| `VITE_CESIUM_ION_TOKEN` | No | Cesium Ion access token |

### Render (Backend)
| Variable | Required | Example |
|---|---|---|
| `BUSTARON_ENV` | Yes | `production` |
| `BUSTARON_CORS_ORIGIN` | Yes | `https://bustaron.vercel.app` |
| `BUSTARON_DATA_DIR` | No | Defaults to `server/data` |
| `BUSTARON_AUTHORITY_NODE_ADMIN_SEED` | Yes (prod) | 64 hex chars |
| `BUSTARON_AUTHORITY_NODE_AGENT_A_SEED` | Yes (prod) | 64 hex chars |
| `BUSTARON_AUTHORITY_NODE_AGENT_B_SEED` | Yes (prod) | 64 hex chars |

---

## Troubleshooting

**Frontend loads but no data appears:**
- Check `VITE_M3_API_URL` is set to the Render URL (no trailing slash).
- Open browser DevTools > Network tab — look for failed `/api/*` requests.
- If CORS errors appear, verify `BUSTARON_CORS_ORIGIN` on Render matches your Vercel URL exactly (including `https://`).

**Backend returns 500 on startup:**
- If `BUSTARON_ENV=production`, all three `*_SEED` vars must be set (64 hex chars each).
- Check Render logs: Dashboard > Service > Logs.

**Backend is slow to respond:**
- Render free tier sleeps after 15 min inactivity. First request takes ~30s to cold-start.
- Vercel frontend will show a loading state during this time.

**Map is blank:**
- `VITE_MAPBOX_TOKEN` is not set — the app falls back to the offline SVG schematic map (expected behavior).
- For the real Mapbox map, set the token in Vercel environment variables.
