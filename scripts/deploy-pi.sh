#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose_file="$repo_root/docker-compose.pi.yml"
env_file="$repo_root/.env.pi"
secret_file="$repo_root/.jwt_secret"
expected_remote="https://github.com/Hyliard/auth-api.git"

cd "$repo_root"

if [[ "$(git rev-parse --show-toplevel)" != "$repo_root" ]]; then
  echo "Error: scripts/deploy-pi.sh must run from the auth-api repository." >&2
  exit 1
fi

if [[ "$(git remote get-url origin)" != "$expected_remote" ]]; then
  echo "Error: origin does not point to the expected auth-api repository." >&2
  exit 1
fi

if [[ "$(git branch --show-current)" != "main" ]]; then
  echo "Error: deployment requires the main branch." >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Error: tracked files contain staged or unstaged changes." >&2
  exit 1
fi

unexpected_untracked="$(git ls-files --others --exclude-standard | grep -Ev '^(\.jwt_secret|\.env\.pi)$' || true)"
if [[ -n "$unexpected_untracked" ]]; then
  echo "Error: unexpected untracked files are present:" >&2
  printf '%s\n' "$unexpected_untracked" >&2
  exit 1
fi

if [[ ! -f "$secret_file" ]]; then
  echo "Error: .jwt_secret is required." >&2
  exit 1
fi

if [[ "$(stat -c '%a' "$secret_file")" != "600" ]]; then
  echo "Error: .jwt_secret must have permissions 600." >&2
  exit 1
fi

if [[ ! -f "$env_file" ]]; then
  echo "Error: .env.pi is required." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "Error: Docker Compose is required." >&2
  exit 1
fi

export JWT_SECRET
JWT_SECRET="$(<"$secret_file")"
if [[ -z "$JWT_SECRET" ]]; then
  echo "Error: .jwt_secret must not be empty." >&2
  exit 1
fi

compose=(docker compose --env-file "$env_file" -f "$compose_file")

git pull --ff-only origin main

"${compose[@]}" up -d authdemo-db
"${compose[@]}" build authdemo-api
"${compose[@]}" run --rm authdemo-api npx prisma migrate deploy
"${compose[@]}" up -d --no-deps authdemo-api
"${compose[@]}" ps

for attempt in $(seq 1 30); do
  if curl --fail --silent --show-error http://127.0.0.1:3004/api/health >/dev/null; then
    echo "Health check passed: http://127.0.0.1:3004/api/health"
    exit 0
  fi
  sleep 2
done

echo "Error: API health check failed." >&2
docker logs --tail 100 authdemo-api >&2
exit 1
