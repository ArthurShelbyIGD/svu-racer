#!/bin/sh
# BUILD, AND FAIL LOUDLY IF IT FAILED.
#
# `npm run build 2>&1 | tail -1` hid a broken build for half an hour: esbuild
# had gone missing, the error went to stderr, and the last line of the output
# was blank — so the check printed nothing and nothing read as fine. Meanwhile
# every screenshot and every measurement was of a stale docs/index.html, and I
# spent the time hunting a bug in code that was never in the file.
#
# A build check has to assert the build SUCCEEDED, not just run it.
set -e
cd "$(dirname "$0")/.."
out=$(node build.mjs 2>&1) || { echo "$out"; echo "BUILD FAILED"; exit 1; }
echo "$out" | grep -q 'build: docs/index.html' || { echo "$out"; echo "BUILD PRODUCED NO OUTPUT LINE"; exit 1; }
echo "$out"
