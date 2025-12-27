#!/usr/bin/env bash
set -euo pipefail

# Simple deploy script for the linux-server-bot branch
# Behavior:
# - fetches origin/linux-server-bot
# - if remote changed, resets working tree to remote
# - runs npm ci, build and restarts pm2 process (fallback to nohup)

REPO_DIR="/Users/mac/ironchain"
BRANCH="main"

cd "$REPO_DIR"

echo "$(date '+%Y-%m-%d %H:%M:%S') - deploy check for $BRANCH in $REPO_DIR"

# Ensure origin exists
git remote get-url origin >/dev/null 2>&1 || { echo "No origin remote configured"; exit 1; }

git fetch origin "$BRANCH" || { echo "Branch $BRANCH not found on origin"; exit 0; }

REMOTE_REV=$(git rev-parse "origin/$BRANCH")
LOCAL_REV=$(git rev-parse --verify HEAD || true)

if [ "$LOCAL_REV" != "$REMOTE_REV" ]; then
  echo "Updating to $REMOTE_REV"
  # Try to checkout the branch (create if missing)
  if git show-ref --verify --quiet refs/heads/$BRANCH; then
    git checkout $BRANCH
  else
    git checkout -b $BRANCH "origin/$BRANCH"
  fi

  git reset --hard "origin/$BRANCH"

  # Install deps (production) and build
  if command -v npm >/dev/null 2>&1; then
    npm ci --no-audit --prefer-offline --no-fund || npm install --no-audit --no-fund
    npm run build || true
  fi

  # Ensure logs dir exists
  mkdir -p logs

  # Restart process (pm2 preferred)
  if command -v pm2 >/dev/null 2>&1; then
    pm2 describe ironchain-linux >/dev/null 2>&1 && pm2 restart ironchain-linux || pm2 start dist/index.js --name ironchain-linux
  else
    # fallback: kill existing and start in background
    pkill -f "node dist/index.js" || true
    nohup node dist/index.js > logs/server.out 2>&1 &
  fi

  echo "Deploy finished at $(date '+%Y-%m-%d %H:%M:%S')"
else
  echo "No changes (local==$LOCAL_REV, remote==$REMOTE_REV)"
fi

exit 0
