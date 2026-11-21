#!/usr/bin/env bash
# Daily backup of all four Pichci volumes (PostgreSQL, recipe images, DataProtection keys, Sous Codex state).
# Example cron (04:30 every day):
#   30 4 * * * /home/pichci_admin/Mise/scripts/backup.sh >> /home/pichci_admin/mise-backups/backup.log 2>&1
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$HOME/mise-backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date +%Y-%m-%d_%H%M%S)"
TARGET="$BACKUP_DIR/$STAMP"

mkdir -p "$TARGET"
cd "$REPO_DIR"

# Load non-sensitive DB identifiers if present in .env
POSTGRES_USER="${POSTGRES_USER:-mise}"
POSTGRES_DB="${POSTGRES_DB:-mise}"
if [ -f .env ]; then
  u="$(grep -E '^POSTGRES_USER=' .env | tail -n1 | cut -d= -f2- || true)"
  d="$(grep -E '^POSTGRES_DB=' .env | tail -n1 | cut -d= -f2- || true)"
  [ -n "$u" ] && POSTGRES_USER="$u"
  [ -n "$d" ] && POSTGRES_DB="$d"
fi

echo "[$STAMP] Backing up PostgreSQL..."
docker compose exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$TARGET/db.dump"

echo "[$STAMP] Backing up DataProtection keys (mise-keys)..."
docker compose exec -T api tar -czf - -C /data keys > "$TARGET/keys.tar.gz"

echo "[$STAMP] Backing up recipe & exercise images (mise-images)..."
docker compose exec -T api tar -czf - -C /data images > "$TARGET/images.tar.gz"

echo "[$STAMP] Backing up Sous Codex volume (sous-codex)..."
docker compose exec -T sous tar -czf - -C /data codex > "$TARGET/sous-codex.tar.gz" || true

chmod 600 "$TARGET"/*
echo "[$STAMP] Pruning backups older than $KEEP_DAYS days..."
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -exec rm -rf {} +
echo "[$STAMP] Backup complete: $TARGET ($(du -sh "$TARGET" | cut -f1))"
