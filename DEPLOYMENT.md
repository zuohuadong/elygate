# Elygate Enterprise Deployment Guide

This guide provides step-by-step instructions to deploy Elygate in a private enterprise environment using Docker.

> For the current three-layer Enterprise deployment gate, SupAuth/SupaCloud variables, control-plane smoke checks, and rollback flow, read [Elygate Enterprise Deployment Runbook](docs/ENTERPRISE_DEPLOYMENT_RUNBOOK.md) first.

## Prerequisites

- Docker and Docker Compose
- Bun (optional, for running local scripts)
- At least 4GB of RAM for the full stack

## 1. Environment Configuration

Create a `.env` file in the root directory based on `.env.example`:

```bash
ELYGATE_DB_PASSWORD=replace-with-a-strong-password
DATABASE_URL=postgresql://dbuser_dba:replace-with-a-strong-password@db:5432/postgres
JWT_SECRET=your-random-secret
ORG_NAME="Your Company Name"
ADMIN_USER="admin"
ADMIN_PASSWORD="replace-with-a-strong-admin-password"
```

Set `ELYGATE_DB_PASSWORD` before the first Docker startup. Existing PostgreSQL volumes keep the password they were initialized with.

## 2. Start Services

Launch the infrastructure (PostgreSQL, Gateway, Web, and Portal):

```bash
docker-compose up -d --build
```

## 3. System Initialization (Onboarding)

Once the database is ready, run the onboarding script to create your first organization and Super Admin account:

```bash
# Using local Bun
bun run packages/db/src/onboard.ts

# Or via Docker if preferred
docker exec -it elygate-gateway bun run packages/db/src/onboard.ts
```

## 4. Accessing the Portal

- **Admin Console**: `http://localhost:3001` (for system administrators)
- **Enterprise Portal / API Gateway**: `http://localhost:3000`
- **API Gateway**: `http://localhost:3003`

Log in to the admin console with the `ADMIN_USER` and `ADMIN_PASSWORD` defined in your environment.

## Enterprise Three-Layer Model

Current Elygate Enterprise deployments have three layers:

- **Basic Gateway**: `/v1/*` AI data plane using `sk-*` API keys.
- **Elygate Panel**: general admin panel for channels, models, API keys, usage, logs, and settings.
- **Elygate Enterprise**: `/api/enterprise/*` control plane and `/enterprise/` console, powered by SupaCloud + SupAuth + svadmin.

Production enterprise mode must set `SUPAUTH_JWKS_URL` and `ENTERPRISE_AUTH_MODE=strict`. Gateway `sk-*` keys are not accepted by enterprise control-plane APIs.

## 5. Member Management

Within the Enterprise Portal, you can:
- **Add Members**: Directly create user accounts for your team.
- **Set Quotas**: Assign specific credit limits to users.
- **Configure Policies**: Restrict access to specific LLM models or IP ranges via CIDR.

## 6. Audit Logging

All request and response payloads are captured and can be inspected in the **Logs** section of the Enterprise Portal for deep auditing and compliance.
