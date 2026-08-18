#!/bin/sh
# THE BACKUP TARBALL, IN THE ONE SHAPE THAT WORKS.
#
# Writes racer-src.tgz — the file RECOVER.md documents as the master copy — and
# it exists because hand-rolling the tar got it wrong and cost Anthony a
# confusing git session.
#
# TWO PROPERTIES, AND BOTH ARE LOad-BEARING:
#
#   1. THE CONTENTS ARE AT THE TOP LEVEL, with no wrapping directory. Anthony
#      extracts this straight over his working tree and then commits from it:
#
#          tar -xzf ~/Downloads/racer-src.tgz
#          git add -A && git commit -m "..." && git push
#
#      A `racer/` wrapper turns that into a nested copy sitting beside the real
#      files: the working tree is not updated at all, and git adds the new
#      folder as a stray directory instead.
#
#   2. IT CONTAINS NO .git. This is the one that actually bit. With a `.git`
#      inside, the extracted folder IS a git repository, so `git add -A` in the
#      outer repo hits "you've added another git repository inside your current
#      repository" and stages a gitlink — a pointer to a commit in a repo that
#      does not exist anywhere else. Pushing that gives everyone else an empty
#      folder.
#
#      History is not lost by leaving it out: this container's git is scratch,
#      the real history is Anthony's own repo, and RECOVER.md's line "the
#      history was never where the reasoning lived" is the standing decision —
#      the reasoning is in the comments, which are in the tarball.
#
#   sh tools/pack.sh [destination-directory]
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=${1:-/root}/racer-src.tgz

# -C into the tree and pass `.` so the archive has no wrapping directory.
# node_modules is 200MB of things npm can fetch again; .git is excluded for the
# reason above; shots/ is throwaway harness output.
tar -czf "$OUT" -C "$ROOT" \
    --exclude=./node_modules \
    --exclude=./.git \
    --exclude=./shots \
    .

echo "wrote $OUT  ($(du -h "$OUT" | cut -f1))"
echo
echo "  top of the archive — must be files, not a wrapping directory:"
tar tzf "$OUT" | head -4 | sed 's/^/    /'
# A LOUD FAILURE RATHER THAN A QUIET WRONG FILE. Both of these have happened.
if tar tzf "$OUT" | grep -q '^\./\.git/'; then
  echo "  *** .git IS IN THE ARCHIVE — this will break Anthony's commit. ***" >&2
  exit 1
fi
if [ "$(tar tzf "$OUT" | head -1)" != "./" ]; then
  echo "  *** the archive has a wrapping directory — it must not. ***" >&2
  exit 1
fi
echo "  no .git, no wrapping directory."
