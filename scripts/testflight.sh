#!/usr/bin/env bash
# Build Sentry for the App Store and upload it to TestFlight.
#
#   scripts/testflight.sh             # regenerate ios/, archive, upload
#   scripts/testflight.sh --no-upload # stop after exporting the .ipa
#
# Needs: an active (paid, unexpired) Apple Developer Program team set as
# ios.appleTeamId in app.json (or TEAM_ID=... in the env). An expired
# membership signs like a free team and the archive fails on the App Group
# entitlement. Xcode must be signed in to that team
# (Xcode > Settings > Accounts), and the app created in App Store Connect
# with bundle ID com.giosferrazza.sentryspike.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)
OUT="$ROOT/build/testflight"
UPLOAD=1
[[ "${1:-}" == "--no-upload" ]] && UPLOAD=0

json() { node -p "require('./app.json').expo.$1 ?? ''"; }
TEAM_ID=${TEAM_ID:-$(json ios.appleTeamId)}
VERSION=$(json version)
# Build numbers must increase with every upload; a timestamp always does.
BUILD=$(date +%y%m%d%H%M)

if [[ -z "$TEAM_ID" ]]; then
  echo "✖ No team. Set ios.appleTeamId in app.json (developer.apple.com > Membership)."
  exit 1
fi

echo "▸ Sentry $VERSION ($BUILD), team $TEAM_ID"
rm -rf "$OUT" && mkdir -p "$OUT"

echo "▸ Regenerating ios/"
CI=1 npx expo prebuild --clean -p ios > "$OUT/prebuild.log" 2>&1 || {
  tail -20 "$OUT/prebuild.log"; exit 1
}

# The widget reads its version from build settings; point the app's
# Info.plist at the same settings so both always match (App Store requires it).
PLIST=ios/sentryspike/Info.plist
/usr/libexec/PlistBuddy -c 'Set :CFBundleVersion $(CURRENT_PROJECT_VERSION)' "$PLIST"
/usr/libexec/PlistBuddy -c 'Set :CFBundleShortVersionString $(MARKETING_VERSION)' "$PLIST"

echo "▸ Archiving (several minutes)"
xcodebuild archive \
  -workspace ios/sentryspike.xcworkspace \
  -scheme sentryspike \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$OUT/Sentry.xcarchive" \
  -derivedDataPath "$OUT/DerivedData" \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  CURRENT_PROJECT_VERSION="$BUILD" \
  MARKETING_VERSION="$VERSION" \
  > "$OUT/archive.log" 2>&1 || {
  grep -E "error:" "$OUT/archive.log" | sort -u | head -20
  echo "✖ Archive failed. Full log: $OUT/archive.log"; exit 1
}

cat > "$OUT/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>$([[ $UPLOAD == 1 ]] && echo upload || echo export)</string>
  <key>teamID</key><string>$TEAM_ID</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict>
</plist>
PLIST

if [[ $UPLOAD == 1 ]]; then echo "▸ Uploading to App Store Connect"; else echo "▸ Exporting .ipa"; fi
xcodebuild -exportArchive \
  -archivePath "$OUT/Sentry.xcarchive" \
  -exportPath "$OUT/export" \
  -exportOptionsPlist "$OUT/ExportOptions.plist" \
  -allowProvisioningUpdates \
  > "$OUT/export.log" 2>&1 || {
  grep -E "error|Error" "$OUT/export.log" | sort -u | head -20
  echo "✖ Export/upload failed. Full log: $OUT/export.log"; exit 1
}

if [[ $UPLOAD == 1 ]]; then
  echo "✔ Uploaded $VERSION ($BUILD). It appears in App Store Connect > TestFlight"
  echo "  after processing (usually 5-15 min); Apple emails you when it's ready."
else
  echo "✔ Exported: $(ls "$OUT"/export/*.ipa)"
fi
