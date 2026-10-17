#!/bin/bash
# Runs the validation cases through Earthquake Playground's engine (src/sim.ts) in headless Chrome with WebGPU, and writes
# validation/out/qv/<case>.f32 / .json. Needs out/cases.json (python cases.py) and Google Chrome.
set -e
cd "$(dirname "$0")/.."
# a full run starts clean; a run of some cases (a name, or a prefix ending in *) keeps the others
if [ -z "$1" ]; then rm -rf validation/out/qv; fi
mkdir -p validation/out/qv; rm -f validation/out/qv/done.json validation/out/qv/error.txt
npx vite --config validation/vite.config.ts --logLevel warn > validation/out/vite.log 2>&1 &
VITE=$!
trap 'kill $VITE 2>/dev/null; [ -n "$CHROME" ] && kill $CHROME 2>/dev/null' EXIT
for i in $(seq 50); do curl -s -o /dev/null http://localhost:5178/ && break; sleep 0.2; done
CHROME_BIN="${CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
PROFILE=$(mktemp -d)
"$CHROME_BIN" --headless=new --enable-unsafe-webgpu --enable-features=Vulkan --user-data-dir="$PROFILE" \
  --no-first-run --disable-gpu-sandbox "http://localhost:5178/validation/qv/runner.html${1:+?case=$(printf %s "$1" | sed "s/@/%40/g; s/\*/%2A/g")}" > validation/out/chrome.log 2>&1 &
CHROME=$!
for i in $(seq 7200); do
  [ -f validation/out/qv/done.json ] && { echo "Earthquake Playground runs done"; cat validation/out/qv/done.json; echo; exit 0; }
  [ -f validation/out/qv/error.txt ] && { echo "runner failed:"; cat validation/out/qv/error.txt; exit 1; }
  sleep 1
done
echo "timed out"; exit 1
