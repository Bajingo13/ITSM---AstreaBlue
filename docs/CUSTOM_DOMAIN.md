# Custom Domain Setup (Railway + DNS)

Applies to each independent deployment. Suggested naming:

| Deployment | Frontend domain | Backend domain |
| --- | --- | --- |
| AstreaBlue Main | `astreablueitsm.com` (and `www.astreablueitsm.com`) | `api.astreablueitsm.com` |
| AOC (Standard) | `aoc.astreablueitsm.com` | `api.aoc.astreablueitsm.com` |

> Prerequisite: you must own `astreablueitsm.com` and be able to edit its DNS records. If the domain is not yet registered, register it first (any registrar) and complete the steps below afterwards. Nothing in this repo needs to change — only Railway settings, DNS records, and three environment variables per deployment.

## 1. Add the domains in Railway

For **each** service (Main frontend, Main backend, AOC frontend, AOC backend):

1. Railway → project → the service → **Settings → Networking → Custom Domain → + Custom Domain**.
2. Enter the domain from the table above.
3. Railway shows a target value:
   - an apex domain (`astreablueitsm.com`) needs an **ALIAS/ANAME** record, or Railway's Cloudflare-style flattening, pointing at the shown target;
   - a subdomain (`aoc.…`, `api.…`, `www.…`) needs a **CNAME** record pointing at the shown `*.up.railway.app` target.
4. Leave the tab open — Railway polls DNS and issues a Let's Encrypt certificate automatically once the record resolves.

## 2. Create the DNS records at the registrar

Example (values in the "Target" column come from Railway, they are not fixed):

| Type | Name | Target | Used by |
| --- | --- | --- | --- |
| ALIAS/ANAME (or A/flattened) | `@` (`astreablueitsm.com`) | `<main-frontend>.up.railway.app` | Main frontend |
| CNAME | `www` | `<main-frontend>.up.railway.app` | Main frontend |
| CNAME | `api` | `<main-backend>.up.railway.app` | Main backend |
| CNAME | `aoc` | `<aoc-frontend>.up.railway.app` | AOC frontend |
| CNAME | `api.aoc` | `<aoc-backend>.up.railway.app` | AOC backend |

If the registrar cannot do ALIAS/ANAME at the apex, either move the domain's nameservers to a DNS host that can (Cloudflare, Route 53), or use `www` as the canonical frontend and add an apex→`www` redirect at the registrar/DNS host.

TTL 300 while setting up; raise to 3600+ once stable. Propagation is usually minutes, up to ~24h.

## 3. Point the apps at the new domains

After the certificates are **Active** in Railway, update these variables and redeploy. The frontend variable is build-time, so the frontend must be rebuilt.

### Main

```env
# Main backend service
FRONTEND_URL=https://astreablueitsm.com
CORS_ALLOWED_ORIGINS=https://www.astreablueitsm.com
```
```env
# Main frontend service (triggers a rebuild)
VITE_API_URL=https://api.astreablueitsm.com
```

### AOC

```env
# AOC backend service
FRONTEND_URL=https://aoc.astreablueitsm.com
```
```env
# AOC frontend service (triggers a rebuild)
VITE_API_URL=https://api.aoc.astreablueitsm.com
```

`server.js` builds its CORS allow-list from `FRONTEND_URL` plus the comma-separated `CORS_ALLOWED_ORIGINS`, and production startup rejects non-HTTPS origins, so both must be `https://`.

## 4. Verify

For each deployment:

```
curl https://api.<domain>/api/health
```
- `deployment.instance_id` / `deployment.profile` match the intended deployment (MAIN vs AOC/STANDARD).
- Open the frontend domain in a browser, sign in, confirm no CORS errors in the console (the browser origin must be exactly `FRONTEND_URL` or a listed `CORS_ALLOWED_ORIGINS` value — no trailing slash).
- On AOC: `curl https://api.aoc.<domain>/api/v1/integrations` returns `403 DEPLOYMENT_CAPABILITY_DISABLED` (isolation intact).
- Update the agent enrollment / installer to use the deployment's new `https://api.…` backend URL for any new enrollments. Existing enrolled agents keep working on the old `*.up.railway.app` host until reconfigured; keep that host reachable during the transition.

## 5. Old URLs

Railway keeps the generated `*.up.railway.app` domain working alongside the custom one. Don't remove it until every frontend build, agent config, and external integration points at the custom domain.
