# AstreaBlue ITSM

AstreaBlue is an IT service management and endpoint monitoring system with a React frontend, Node.js/Express backend, PostgreSQL database, and native Windows monitoring agent.

## Repository Structure

- `backend/` - API, database initialization, migrations, services, and tests
- `frontend/` - React and Vite web application
- `agent-windows/` - JavaScript and native C# Windows agents
- `docs/` - architecture, workflow, and external API documentation
- `documentation/` - user-facing system documentation

Runtime uploads, generated builds, dependency folders, local environment files, agent packages, and personal reports are intentionally excluded from Git.

## Prerequisites

- Node.js 22 and npm
- PostgreSQL available on `localhost:5432`
- PowerShell on Windows
- .NET Framework C# compiler for building the native Windows agent

## Local Setup

1. Create a PostgreSQL database named `it_asset_management`.
2. Copy `backend/.env.example` to `backend/.env` and enter local credentials.
3. Copy `frontend/.env.example` to `frontend/.env`.
4. Install dependencies and initialize the application:

```powershell
cd backend
npm.cmd ci
npm.cmd run build
npm.cmd start
```

In another terminal:

```powershell
cd frontend
npm.cmd ci
npm.cmd run lint
npm.cmd run build
npm.cmd run dev
```

The backend initializes pending migrations during startup. Local development must use the local PostgreSQL database and must not use production credentials.

## Validation

```powershell
cd backend
npm.cmd test

cd ..\frontend
npm.cmd run lint
npm.cmd run build

cd ..\agent-windows
npm.cmd run check

cd native-agent
.\build-native-agent.ps1
```

Generated native-agent binaries are written to `agent-windows/native-agent/dist/` and are not committed. Create a distributable package with `create-native-package.ps1` after a successful build.

## Deployment

Production configuration is supplied by the hosting environment. Never commit `.env` files, credentials, runtime uploads, generated packages, or database exports. Review migrations and run all validation commands before deployment.

Independent Railway installations use one codebase with separate PostgreSQL databases and explicit deployment profiles. See [Deployment Profiles](docs/DEPLOYMENT_PROFILES.md) before deploying Main or provisioning a Standard installation.
