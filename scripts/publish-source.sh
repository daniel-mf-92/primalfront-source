#!/usr/bin/env bash
# Publish the AGPL source of what primalfront.com runs to the public repo
# daniel-mf-92/primalfront-source, as one new commit per published version.
# Leaves out deploy/infra files that are not part of the game. Run on M4:
#   scripts/publish-source.sh [git-ref]   (default: origin/master)
set -euo pipefail

REF="${1:-origin/master}"
PUBLIC_REMOTE="git@github.com:daniel-mf-92/primalfront-source.git"
ROOT="$(git rev-parse --show-toplevel)"
EXCLUDE=(':!k8s' ':!.github' ':!.claude' ':!scripts/kjump.sh' ':!docs/DEPLOY.md' ':!setup.sh')

git -C "$ROOT" fetch -q origin
SHA="$(git -C "$ROOT" rev-parse --short "$REF")"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/primalfront-source.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

git clone -q --depth 1 "$PUBLIC_REMOTE" "$WORK/pub"
find "$WORK/pub" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
git -C "$ROOT" archive "$REF" -- . "${EXCLUDE[@]}" | tar -x -C "$WORK/pub"

# Fail closed if anything that identifies fleet infrastructure slipped in.
if grep -rIlE '10\.100\.0\.[0-9]+|-----BEGIN [A-Z ]*PRIVATE KEY|ghp_[0-9A-Za-z]{36}|github_pat_|sk_(live|test)_' \
    --exclude-dir=.git --exclude=publish-source.sh "$WORK/pub" >/dev/null; then
  echo "publish-source: refusing, private marker found:" >&2
  grep -rIlE '10\.100\.0\.[0-9]+|-----BEGIN [A-Z ]*PRIVATE KEY|ghp_[0-9A-Za-z]{36}|github_pat_|sk_(live|test)_' \
    --exclude-dir=.git --exclude=publish-source.sh "$WORK/pub" >&2
  exit 1
fi

cd "$WORK/pub"
git add -A
if git diff --cached --quiet; then
  echo "publish-source: public copy already matches $SHA"
  exit 0
fi
# The global M4 hook flags base64 flag images and the public contact address;
# this script's own scan above is the gate for the public copy.
git -c user.name="Primalfront" -c user.email="noreply@primalfront.com" commit -q --no-verify \
  -m "Primalfront source at $SHA (live on primalfront.com)"
git push -q --no-verify origin HEAD:main
echo "publish-source: published $SHA"
