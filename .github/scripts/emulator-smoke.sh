#!/usr/bin/env bash
# Runs inside the emulator step: installs the APK, launches the app, and
# fails loudly with the crash stack if the process dies.
set -uo pipefail

adb install -r splts.apk
adb logcat -c
adb shell am start -n org.splts.app/.MainActivity
sleep 30
adb exec-out screencap -p > emulator-screenshot.png
adb logcat -d > emulator-logcat.txt

pid="$(adb shell pidof org.splts.app || true)"
crashed=""
if [ -z "$pid" ]; then
  echo "::error::App process is not running 30s after launch"
  crashed=1
fi
if grep -q "FATAL EXCEPTION" emulator-logcat.txt; then
  echo "::error::FATAL EXCEPTION in logcat"
  crashed=1
fi

symbolicate() {
  local logfile="$1"
  local map
  map=$(find apps/mobile/android/app/build/intermediates/sourcemaps -name 'index.android.bundle.map' 2>/dev/null | head -1)
  if [ -z "$map" ]; then echo "(no source map found)"; return; fi
  grep -o '[A-Za-z0-9_$<>.]*@1:[0-9]*' "$logfile" | head -40 > hermes-stack.txt || true
  if [ -s hermes-stack.txt ]; then
    echo "===== SYMBOLICATED STACK ====="
    npx metro-symbolicate "$map" < hermes-stack.txt || true
  fi
}

if [ -n "$crashed" ]; then
  symbolicate emulator-logcat.txt
  echo "===== FATAL EXCEPTION context ====="
  grep -B 2 -A 80 "FATAL EXCEPTION" emulator-logcat.txt || true
  echo "===== runtime-not-ready context ====="
  grep -B 10 -A 60 "runtime not ready" emulator-logcat.txt || true
  echo "===== Last ReactNativeJS lines ====="
  grep "ReactNativeJS" emulator-logcat.txt | tail -60 || true
  echo "===== Error-level lines (tail) ====="
  grep -E " E | F |Fatal signal|DEBUG   :" emulator-logcat.txt | tail -100 || true
  exit 1
fi

echo "App launched and is running (pid $pid)."
echo "===== ReactNativeJS output ====="
grep "ReactNativeJS" emulator-logcat.txt | tail -40 || true
