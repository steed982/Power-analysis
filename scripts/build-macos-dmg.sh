#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="Power Analyzer"
VOL_NAME="Power Analyzer Installer"
BUILD_DIR="$ROOT_DIR/build"
DIST_DIR="$ROOT_DIR/dist"
APP_PATH="$BUILD_DIR/${APP_NAME}.app"
STAGE_DIR="$BUILD_DIR/dmg"
DMG_PATH="$DIST_DIR/Power-Analyzer-macOS.dmg"
ICONSET_DIR="$BUILD_DIR/AppIcon.iconset"
ICON_PNG="$BUILD_DIR/AppIcon-1024.png"
ICON_ICNS="$BUILD_DIR/AppIcon.icns"

echo "[1/6] Cleaning previous build artifacts..."
rm -rf "$APP_PATH" "$STAGE_DIR" "$DMG_PATH" "$ICONSET_DIR" "$ICON_PNG" "$ICON_ICNS"
mkdir -p "$BUILD_DIR" "$DIST_DIR" "$STAGE_DIR"

echo "[2/6] Generating app icon (.icns)..."
python3 "$ROOT_DIR/scripts/generate_app_icon.py" "$ICON_PNG"
mkdir -p "$ICONSET_DIR"

sips -z 16 16     "$ICON_PNG" --out "$ICONSET_DIR/icon_16x16.png" >/dev/null
sips -z 32 32     "$ICON_PNG" --out "$ICONSET_DIR/icon_16x16@2x.png" >/dev/null
sips -z 32 32     "$ICON_PNG" --out "$ICONSET_DIR/icon_32x32.png" >/dev/null
sips -z 64 64     "$ICON_PNG" --out "$ICONSET_DIR/icon_32x32@2x.png" >/dev/null
sips -z 128 128   "$ICON_PNG" --out "$ICONSET_DIR/icon_128x128.png" >/dev/null
sips -z 256 256   "$ICON_PNG" --out "$ICONSET_DIR/icon_128x128@2x.png" >/dev/null
sips -z 256 256   "$ICON_PNG" --out "$ICONSET_DIR/icon_256x256.png" >/dev/null
sips -z 512 512   "$ICON_PNG" --out "$ICONSET_DIR/icon_256x256@2x.png" >/dev/null
sips -z 512 512   "$ICON_PNG" --out "$ICONSET_DIR/icon_512x512.png" >/dev/null
cp "$ICON_PNG" "$ICONSET_DIR/icon_512x512@2x.png"

iconutil -c icns "$ICONSET_DIR" -o "$ICON_ICNS"

echo "[3/6] Building macOS app wrapper..."
mkdir -p "$APP_PATH/Contents/MacOS" "$APP_PATH/Contents/Resources/web"

cat > "$APP_PATH/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>launcher</string>
  <key>CFBundleIdentifier</key>
  <string>com.steed.poweranalyzer</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>Power Analyzer</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
</dict>
</plist>
PLIST

cat > "$APP_PATH/Contents/MacOS/launcher" <<'LAUNCHER'
#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB_ENTRY="$APP_ROOT/Resources/web/index.html"
exec /usr/bin/open "$WEB_ENTRY"
LAUNCHER

chmod +x "$APP_PATH/Contents/MacOS/launcher"
cp "$ICON_ICNS" "$APP_PATH/Contents/Resources/AppIcon.icns"

echo "[4/6] Copying web assets into app bundle..."
mkdir -p "$APP_PATH/Contents/Resources/web"
cp "$ROOT_DIR/index.html" "$APP_PATH/Contents/Resources/web/"
cp "$ROOT_DIR/app.js" "$APP_PATH/Contents/Resources/web/"
cp "$ROOT_DIR/styles.css" "$APP_PATH/Contents/Resources/web/"

echo "[5/6] Preparing DMG staging folder..."
cp -R "$APP_PATH" "$STAGE_DIR/"
ln -s /Applications "$STAGE_DIR/Applications"

echo "[6/6] Creating DMG..."
hdiutil create -volname "$VOL_NAME" -srcfolder "$STAGE_DIR" -ov -format UDZO "$DMG_PATH" > /dev/null

echo
echo "Done."
echo "App: $APP_PATH"
echo "DMG: $DMG_PATH"
