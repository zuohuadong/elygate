# Elygate Enterprise Deployment Guide

This guide provides step-by-step instructions to deploy Elygate in a private enterprise environment using Docker.

## Prerequisites

- Docker and Docker Compose
- Bun (optional, for running local scripts)
- At least 4GB of RAM for the full stack

## 1. Environment Configuration

Create a `.env` file in the root directory based on `.env.example`:

```bash
DATABASE_URL=postgresql://dbuser_dba:DBUser.DBA@db:5432/postgres
AUTH_SECRET=your-random-secret
ORG_NAME="Your Company Name"
ADMIN_USER="admin"
ADMIN_PASS="password123"
```

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

- **User Portal**: `http://localhost:3001` (for standard users)
- **Enterprise Portal**: `http://localhost:3000` (for organization management)
- **API Gateway**: `http://localhost:3003`

Log in to the Enterprise Portal with the `ADMIN_USER` and `ADMIN_PASS` defined in your environment.

## 5. Member Management

Within the Enterprise Portal, you can:
- **Add Members**: Directly create user accounts for your team.
- **Set Quotas**: Assign specific credit limits to users.
- **Configure Policies**: Restrict access to specific LLM models or IP ranges via CIDR.

## 6. Audit Logging

All request and response payloads are captured and can be inspected in the **Logs** section of the Enterprise Portal for deep auditing and compliance.
