# Aperture Policy Service

REST API for managing operator spending policies. Policies define the rules AI agents must follow: spending limits, allowed categories, sanctions lists, time restrictions, and token whitelists.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/policies` | Create a new policy |
| GET | `/api/v1/policies/:id` | Get policy by ID |
| GET | `/api/v1/policies/operator/:operatorId` | List policies by operator (paginated) |
| PUT | `/api/v1/policies/:id` | Update a policy |
| DELETE | `/api/v1/policies/:id` | Delete a policy |
| GET | `/api/v1/policies/:id/compile` | Compile policy to RISC Zero circuit input format |
| GET | `/health` | Health check |

## Setup

```bash
# From repo root
npm install

# Copy environment
cp .env.example .env

# Run migrations
npm run migrate

# Start development server
npm run dev
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `POSTGRES_HOST` | PostgreSQL host | required |
| `POSTGRES_PORT` | PostgreSQL port | `5432` |
| `POSTGRES_USER` | PostgreSQL user | required |
| `POSTGRES_PASSWORD` | PostgreSQL password | required |
| `POSTGRES_DB` | Database name | required |
| `POLICY_SERVICE_PORT` | Service port | `3001` |
| `USDC_MINT_ADDRESS` | USDC mint on Devnet | required |
| `USDT_MINT_ADDRESS` | USDT mint on Devnet | required |
| `LOG_LEVEL` | Logging level | `info` |

## API Documentation

Swagger UI available at `http://localhost:3001/api-docs`

## Policy Schema

```json
{
  "operator_id": "uuid",
  "name": "string",
  "description": "string (optional)",
  "max_daily_spend": 1000.00,
  "max_per_transaction": 100.00,
  "allowed_endpoint_categories": ["compute", "storage", "api"],
  "blocked_addresses": ["sanctioned-address-1"],
  "time_restrictions": [{
    "allowed_days": ["monday", "tuesday", "wednesday", "thursday", "friday"],
    "allowed_hours_start": 9,
    "allowed_hours_end": 17,
    "timezone": "UTC"
  }],
  "token_whitelist": ["4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"],
  "is_active": true
}
```

## Circuit Compilation

The `/compile` endpoint produces a JSON structure consumable by the RISC Zero guest program (Phase 2). Amounts are converted to lamports (integer representation) for deterministic circuit computation.
