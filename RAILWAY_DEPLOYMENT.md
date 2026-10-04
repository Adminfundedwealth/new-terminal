# Railway Deployment Guide - D6B Execution Worker

## Overview

This guide provides step-by-step instructions for deploying the d6b-execution-worker to Railway. The worker processes execution requests from the order_execution_outbox table using the mock-safe provider.

## Prerequisites

- Railway account with CLI installed (`railway --version` should show v5.49.6 or later)
- Access to Supabase project settings (for credentials)
- GitHub repository access (optional, for GitHub integration)

## Deployment Steps

### 1. Prepare Environment Variables

Before deploying, gather the following credentials from your `.env` file and Supabase project:

| Railway Variable | Source | Example/Notes |
|-----------------|--------|---------------|
| `SUPABASE_URL` | `.env` file: `VITE_SUPABASE_URL` | `https://xxxxx.supabase.co` |
| `SUPABASE_SECRET_KEY` | `.env` file: `SUPABASE_SERVICE_ROLE_KEY` | Service-role key from Supabase API settings |
| `D6B_SYNTHETIC_ACCOUNT_ID` | Fixed value | `d6b00000-0000-4000-8000-000000000002` |
| `D6B_SYNTHETIC_ORDER_ID` | From D7-B verification | `28a945f5-73ff-48be-a78d-36e8024fe959` |
| `PORT` | Fixed value | `8080` |

**Important Security Notes:**
- Never commit the service-role key to version control
- The `SUPABASE_SECRET_KEY` is the service-role key, NOT the publishable/anon key
- These credentials grant full database access; handle with care

### 2. Deploy to Railway

#### Option A: Railway CLI (Recommended)

```powershell
# Navigate to worker-runtime directory
cd worker-runtime

# Link to Railway project (first time only)
railway link

# If no project exists, create one:
# railway init

# Set environment variables
railway variables set SUPABASE_URL="<your-supabase-url>"
railway variables set SUPABASE_SECRET_KEY="<your-service-role-key>"
railway variables set D6B_SYNTHETIC_ACCOUNT_ID="d6b00000-0000-4000-8000-000000000002"
railway variables set D6B_SYNTHETIC_ORDER_ID="28a945f5-73ff-48be-a78d-36e8024fe959"
railway variables set PORT="8080"

# Deploy
railway up
```

#### Option B: Railway Dashboard

1. Go to [Railway Dashboard](https://railway.app/dashboard)
2. Create a new project or select existing project
3. Click "New Service" → "Empty Service"
4. Name it: `d6b-execution-worker`
5. Go to Settings → Source → Connect Repository:
   - Repository: `india-s-best-option-hub`
   - Root Directory: `worker-runtime`
6. Go to Variables tab and add:
   ```
   SUPABASE_URL=<from-env-file>
   SUPABASE_SECRET_KEY=<from-env-file>
   D6B_SYNTHETIC_ACCOUNT_ID=d6b00000-0000-4000-8000-000000000002
   D6B_SYNTHETIC_ORDER_ID=28a945f5-73ff-48be-a78d-36e8024fe959
   PORT=8080
   ```
7. Go to Settings → Deploy:
   - Build Method: Dockerfile
   - Dockerfile Path: `Dockerfile`
   - Start Command: `node worker.mjs`
8. Click "Deploy"

### 3. Verify Deployment

Once deployment completes, Railway will assign a public URL (e.g., `https://d6b-execution-worker-production.up.railway.app`).

#### Health Check Verification

```powershell
# Replace with your actual Railway URL
$workerUrl = "https://d6b-execution-worker-production.up.railway.app"

# Check health endpoint
curl "$workerUrl/healthz"
```

**Expected Response (HTTP 200):**
```json
{
  "status": "READY",
  "worker": "alive",
  "database": "connected",
  "claim_loop": "running",
  "last_poll_at": "2024-01-15T10:30:45.123Z",
  "provider": "mock-safe",
  "scope": "single D6B_TEST order"
}
```

**Possible Status Values:**
- `READY`: Worker is healthy and processing outbox
- `DEGRADED`: Worker is running but claim loop is stale (check logs)
- `NOT_READY`: Database connection failed or scope mismatch (check env vars)

### 4. Verify Worker Processing

#### Check Railway Logs

```powershell
# Via CLI
railway logs

# Or via Dashboard: select service → Deployments → View Logs
```

**Expected Log Entries:**
```json
{"timestamp":"2024-01-15T10:30:00.000Z","level":"info","event":"d6b.worker.started","fields":{"worker_id":"hostname","port":8080,"provider":"mock-safe"}}
{"timestamp":"2024-01-15T10:30:05.123Z","level":"info","event":"execution.attempt_finished","fields":{"outcome":"accepted",...}}
```

#### Verify Outbox Processing

Query Supabase to confirm the worker claimed and processed rows:

```sql
-- Check if D6BSYNTH order was claimed and processed
SELECT 
  id,
  order_id,
  account_id,
  claimed_at,
  claimed_by_worker_id,
  processed_at,
  status
FROM order_execution_outbox
WHERE 
  account_id = 'd6b00000-0000-4000-8000-000000000002'
  AND order_id = '28a945f5-73ff-48be-a78d-36e8024fe959'
ORDER BY created_at DESC
LIMIT 1;
```

**Expected Results:**
- `claimed_at`: IS NOT NULL (timestamp when worker claimed the row)
- `claimed_by_worker_id`: Worker identifier (e.g., `d6b-hostname`)
- `processed_at`: IS NOT NULL (timestamp when processing completed)
- `status`: `processed` or equivalent final state

### 5. Test End-to-End Execution

To test the worker with a fresh outbox row:

```sql
-- Insert a test outbox row (D6BSYNTH only)
INSERT INTO order_execution_outbox (
  account_id,
  order_id,
  command_type,
  command_payload
) VALUES (
  'd6b00000-0000-4000-8000-000000000002',
  '28a945f5-73ff-48be-a78d-36e8024fe959',
  'submit_order',
  '{"account_id":"d6b00000-0000-4000-8000-000000000002","order_id":"28a945f5-73ff-48be-a78d-36e8024fe959","client_order_id":"D6B-SYNTH-TEST-001"}'::jsonb
);

-- Wait 10 seconds for worker to claim and process

-- Verify processing
SELECT claimed_at, processed_at, status 
FROM order_execution_outbox 
WHERE order_id = '28a945f5-73ff-48be-a78d-36e8024fe959'
ORDER BY created_at DESC 
LIMIT 1;
```

## Troubleshooting

### Status: NOT_READY

**Symptom:** Health endpoint returns `"database": "unavailable_or_scope_mismatch"`

**Causes:**
1. Invalid Supabase credentials
2. Wrong D6B_SYNTHETIC_ACCOUNT_ID or D6B_SYNTHETIC_ORDER_ID
3. Database migrations not applied

**Resolution:**
```powershell
# Verify environment variables are set correctly
railway variables

# Check Railway logs for specific error
railway logs | Select-String "error"

# Verify the synthetic account exists in Supabase:
# SELECT id FROM trading_accounts WHERE id = 'd6b00000-0000-4000-8000-000000000002'
```

### Status: DEGRADED

**Symptom:** Health endpoint returns `"claim_loop": "stale_or_failed"`

**Causes:**
1. Claim loop encountered repeated errors
2. Database connection lost
3. Worker crashed during processing

**Resolution:**
```powershell
# Check Railway logs for claim_loop errors
railway logs | Select-String "poll_failed"

# Restart the worker
railway restart
```

### No Outbox Processing

**Symptom:** `claimed_at` remains NULL after 10+ seconds

**Causes:**
1. Worker not polling (check health status)
2. Account/order scope mismatch
3. Outbox row already claimed by another worker

**Resolution:**
```sql
-- Check if row matches worker scope
SELECT 
  account_id = 'd6b00000-0000-4000-8000-000000000002' as account_match,
  order_id = '28a945f5-73ff-48be-a78d-36e8024fe959' as order_match,
  claimed_at IS NULL as unclaimed
FROM order_execution_outbox
WHERE id = '<outbox-row-id>';
```

## Architecture Notes

### Worker Scope Restrictions

The D6B execution worker is **scoped exclusively to D6BSYNTH test data**:
- Account: `d6b00000-0000-4000-8000-000000000002` (prop_firm = 'D6B_TEST')
- Order: `28a945f5-73ff-48be-a78d-36e8024fe959` (client_order_id starts with 'D6B-SYNTH-')

**The worker will reject all other account/order combinations.** This is a safety feature to prevent accidental processing of real orders.

### Mock-Safe Provider

The worker uses the `mock-safe` provider which:
- Does NOT create real broker orders
- Persists execution results via Supabase RPC `d6b_mock_provider_submit`
- Returns synthetic acceptance/fill results
- Preserves D6BSYNTH test data integrity

### Health Check Details

The `/healthz` endpoint performs:
1. Database connectivity test (queries `trading_accounts`, `orders`, `order_execution_outbox`)
2. Scope verification (confirms D6BSYNTH account/order exist)
3. Claim loop freshness check (last poll within 15 seconds)

Health checks run independently of the claim loop and should complete in <1 second.

## Configuration Files

### Dockerfile

Location: `worker-runtime/Dockerfile`

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY worker.mjs ./worker.mjs
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "worker.mjs"]
```

### railway.json

Location: `worker-runtime/railway.json`

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "startCommand": "node worker.mjs",
    "healthcheckPath": "/healthz",
    "healthcheckTimeout": 30,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10,
    "numReplicas": 1,
    "sleepApplication": false
  }
}
```

## Railway CLI Reference

```powershell
# Link to existing project
railway link

# Create new project
railway init

# Set environment variables
railway variables set KEY="value"

# View current variables
railway variables

# Deploy
railway up

# View logs
railway logs

# Restart service
railway restart

# Open Railway dashboard for this project
railway open
```

## Next Steps

After successful deployment:

1. ✅ Record Railway public URL in FEAT-002.json findings
2. ✅ Run verification commands (health check, outbox query, logs)
3. ✅ Update FEAT-002 status to 'completed'
4. ✅ Commit changes with message: `feat: deploy d6b-execution-worker to Railway with health checks`

## Security Checklist

- [ ] Service-role key stored only in Railway environment variables (never committed)
- [ ] Railway project access restricted to authorized team members
- [ ] Worker scoped exclusively to D6BSYNTH test data
- [ ] Mock-safe provider confirmed (no real broker API calls)
- [ ] Health endpoint does not expose credentials or sensitive data
- [ ] Railway logs reviewed for accidental credential leaks

---

**Document Version:** 1.0  
**Last Updated:** 2024 (D8 Task)  
**Related Documentation:**
- `docs/D6_PRODUCTION_HARDENING.md`
- `docs/TASK_D7_A_E2E_CERTIFICATION_PREPARATION.md`
- `worker-runtime/entrypoint.ts` (worker implementation)
