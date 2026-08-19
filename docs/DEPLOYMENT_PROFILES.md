# Deployment Profiles

AstreaBlue uses one maintained codebase and one PostgreSQL database per independent Railway deployment. A deployment profile controls installation-level capabilities; user roles continue to control actions inside that installation.

In this architecture, **AstreaBlue Main**, **AOC**, and **Ortigas** are independent deployments. They are not merely rows in the existing `branches` table. Branch records inside one deployment share that deployment's profile and database, so they cannot receive different installation capabilities.

## Profiles

| Function | `MAIN_HUB` | `STANDARD` |
| --- | --- | --- |
| Normal modules and local tickets | Yes | Yes |
| Users, RBAC, assets, monitoring, reports | Yes | Yes |
| Integration Hub UI and API | Yes | No |
| External ticket intake | Yes | No |
| Cross-system integration analytics | Yes | No |

`STANDARD` is the fail-closed default. Main-only APIs return `403 DEPLOYMENT_CAPABILITY_DISABLED` on a Standard deployment, including requests made with a SuperAdmin account.

Central support remains in the Main application's existing PostgreSQL database. A second support database is not used because central tickets and local tickets already share workflow, notification, reporting, and assignment services. Each Standard deployment has a separate database and never queries Main or another deployment.

## Railway: Main

Set these variables on the Main backend service in addition to the existing production variables:

```env
INSTANCE_ID=MAIN
DEPLOYMENT_PROFILE=MAIN_HUB
FRONTEND_URL=https://<main-frontend-domain>
COMPANY_NAME=AstreaBlue
EMAIL_BRAND_NAME=AstreaBlue ITSM
```

Set this on the Main frontend service before building:

```env
VITE_API_URL=https://<main-backend-domain>
```

Only Main receives external integration API credentials and uses `/api/v1/external` or `/api/v1/integrations`.

## Railway: Standard Deployment

1. Create a new Railway project or isolated environment from the same repository.
2. Add a new, empty PostgreSQL service. Do not clone or restore Main production data.
3. Configure the backend root directory and existing start command.
4. Set unique `DATABASE_URL`, `JWT_SECRET`, `MONITORING_AGENT_TOKEN`, and any enabled service credentials.
5. Set the backend deployment variables:

```env
INSTANCE_ID=AOC
DEPLOYMENT_PROFILE=STANDARD
FRONTEND_URL=https://<aoc-frontend-domain>
COMPANY_NAME=AOC
EMAIL_BRAND_NAME=AOC ITSM
```

6. Set the frontend variable:

```env
VITE_API_URL=https://<aoc-backend-domain>
```

7. Deploy the backend. `npm start` runs `init-db.js`, which applies `BASE_SCHEMA.sql`, ordered migrations, and safe baseline ticket categories.
8. For a fresh database only, temporarily set `BOOTSTRAP_SUPERADMIN_PASSWORD`, `BOOTSTRAP_SUPERADMIN_EMAIL`, `BOOTSTRAP_SUPERADMIN_NAME`, and `COMPANY_NAME`. Start the backend, confirm the administrator can log in, then remove `BOOTSTRAP_SUPERADMIN_PASSWORD` from Railway.
9. Build and deploy the frontend after `VITE_API_URL` is set.
10. Verify `/api/health` reports the intended instance and profile.
11. Verify `/api/v1/integrations` and `/api/v1/external/tickets` return 403 on Standard.
12. Verify local login, ticketing, assets, monitoring, users, and RBAC against the new database.

Generate endpoint enrollment codes from that deployment and pass its own backend URL to the agent installer. Tracked agent files contain no Main backend default, preventing branch devices from being enrolled into Main accidentally.

Do not set Main API keys, Main database credentials, or Main monitoring tokens on a Standard deployment. The tracked frontend no longer contains a production backend URL; each Railway frontend must receive its own `VITE_API_URL` at build time.

Email transport and branding are also deployment-specific. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM_NAME`, `SMTP_FROM_EMAIL`, and `EMAIL_BRAND_NAME` on each backend service. AOC values affect only AOC; Main values affect only Main.

## CORS

`FRONTEND_URL` is the primary browser origin. For multiple trusted origins, provide a comma-separated `CORS_ALLOWED_ORIGINS`. Main production domains are not hardcoded into replicas.

## Rollout Order

Before deploying this version to the existing Main service, add `INSTANCE_ID=MAIN`, `DEPLOYMENT_PROFILE=MAIN_HUB`, and `FRONTEND_URL` in Railway. Production startup fails clearly when deployment identity, database, JWT, or browser-origin configuration is missing. Local development still defaults safely to Standard.

Railway infrastructure provisioning is currently manual: create the backend, frontend, and PostgreSQL services and set their variables for each deployment. The application schema initialization and migrations are automatic when the backend starts; no source-code copy or manual SQL execution is required.
