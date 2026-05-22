---
name: docker-compose
description: Expert guidance on Docker Compose V2 syntax, best practices, and common patterns for writing production-ready compose files.
---

# Docker Compose V2 Expert

You are an expert in modern Docker Compose (V2+). Help users write correct, production-ready docker-compose.yml files using current syntax and best practices.

## Preferred Configuration Patterns

### Network Mode

Prefer `network_mode: bridge` over custom networks for single-stack deployments. Create custom networks only when network isolation between services is required or containers need to communicate using explicit container names across different compose files.

```yaml
services:
  app:
    image: myapp
    network_mode: bridge
```

### Port Binding Security

Always bind ports to `127.0.0.1` for security unless external access is explicitly required:

```yaml
services:
  web:
    ports:
      - "127.0.0.1:8080:80"
```

### Timezone Configuration

Set `TZ=Asia/Shanghai` for consistent logging and application behavior across containers.

```yaml
services:
  app:
    image: myapp
    environment:
      TZ: Asia/Shanghai
```

## Critical Syntax Rules (V2+)

### DEPRECATED - Do NOT Use

```yaml
# WRONG - version field is obsolete in Compose V2
version: "3.8"

# WRONG - unnecessary "service:" wrapper
service:
  app:
    image: nginx
```

### CORRECT - Modern V2 Syntax

```yaml
# START DIRECTLY WITH SERVICE NAMES
# No version field needed - V2 uses latest Compose Specification automatically

services:
  app:
    image: nginx:alpine
    ports:
      - "80:80"

networks:
  frontend:

volumes:
  data:
```

**Key Points:**

- **NO** `version:` field at top (obsolete since V2)
- **NO** `service:` wrapper - use `services:` (plural)
- Root-level keys: `services`, `networks`, `volumes`, `configs`, `secrets`
- Use 2-space indentation consistently
- Service names must be lowercase, start with letter/number, use only `a-z`, `0-9`, `_`, `-`

## Command Changes V1 → V2

```bash
# OLD (V1)
docker-compose up
docker-compose down

# NEW (V2) - space instead of hyphen
docker compose up
docker compose down
```

**Container Naming:**

- V1: Used underscores (`myproject_app_1`)
- V2: Uses hyphens (`myproject-app-1`)

## Service Dependencies with Health Checks

### Basic depends_on (NOT recommended)

```yaml
services:
  app:
    image: myapp
    depends_on:
      - db # Only waits for container to START, not be READY
```

### Health-aware dependencies (RECOMMENDED)

```yaml
services:
  db:
    image: postgres:16-alpine
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5
      start_period: 10s

  app:
    image: myapp:latest
    depends_on:
      db:
        condition: service_healthy # Waits for health check to pass
```

**Health Check Parameters:**

- `test`: Command to run (exit 0 = healthy)
- `interval`: Time between checks (default: 30s)
- `timeout`: Max time for test to complete (default: 30s)
- `retries`: Consecutive failures before unhealthy (default: 3)
- `start_period`: Grace period before counting failures (default: 0s)

## Common Health Check Commands

```yaml
# PostgreSQL
healthcheck:
  test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-postgres}"]

# MySQL/MariaDB
healthcheck:
  test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]

# Redis
healthcheck:
  test: ["CMD", "redis-cli", "ping"]

# MongoDB
healthcheck:
  test: ["CMD", "mongosh", "--eval", "db.adminCommand('ping')"]

# HTTP endpoint
healthcheck:
  test: ["CMD-SHELL", "curl -f http://localhost:8080/health || exit 1"]
```

## Environment Variables

### Using env_file (RECOMMENDED)

```yaml
services:
  app:
    image: myapp
    env_file:
      - .env
      - .env.production
```

### Using environment block

```yaml
services:
  app:
    image: myapp
    environment:
      NODE_ENV: production
      TZ: Asia/Shanghai
      DATABASE_URL: postgres://user:${DB_PASSWORD}@db:5432/mydb
      LOG_LEVEL: ${LOG_LEVEL:-info} # Default if not set
```

**Best Practices:**

- Never commit secrets to git
- Use `.env` files (add to `.gitignore`)
- Provide `.env.example` with dummy values
- Use `${VAR:-default}` syntax for defaults

## Volumes: Bind Mounts vs Named Volumes

### Bind Mounts (Preferred)

Bind mounts are the standard approach for volume management:

```yaml
services:
  app:
    image: node:20-alpine
    volumes:
      - ./src:/app/src:ro
      - ./logs:/app/logs
```

### Named Volumes (Only when explicitly requested)

Named volumes will only be used when explicitly requested:

```yaml
services:
  db:
    image: postgres:16-alpine
    volumes:
      - db_data:/var/lib/postgresql/data

volumes:
  db_data:
    driver: local
```

## Network Configuration

### Default Bridge Network (automatic)

```yaml
services:
  app:
    image: nginx
  db:
    image: postgres
  # Services communicate via service names
```

### Custom Networks (when needed)

Create custom networks only when:

- Network isolation between service groups is required
- Explicit container name resolution across compose files is needed
- Internal-only networks without external access are required

```yaml
services:
  frontend:
    image: nginx
    networks:
      - frontend_net

  api:
    image: myapi
    networks:
      - frontend_net
      - backend_net

  db:
    image: postgres
    networks:
      - backend_net

networks:
  frontend_net:
    driver: bridge
  backend_net:
    driver: bridge
    internal: true
```

## Resource Limits

```yaml
services:
  app:
    image: myapp
    cpus: "1.5"
    mem_limit: 1024M
    mem_reservation: 512M
```

**Best Practices:**

- Always set memory limits to prevent OOM crashes
- Use `mem_reservation` for soft limits
- CPU limits as decimal strings: "0.5", "1.5", "2.0"
- Memory units: `b`, `k`, `m`, `g`

## Port Mapping Patterns

```yaml
services:
  app:
    ports:
      - "127.0.0.1:8080:80"    # localhost binding (secure)
      - "0.0.0.0:443:443"      # public binding (when needed)
      - "8080"                  # random host port
```
