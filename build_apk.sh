#!/usr/bin/env bash
# Сборка APK «Риальто» без Gradle: веб-часть → assets, aapt2 → javac → d8 → zipalign → apksigner.
# Требуется: Node.js 18+, JDK 17+, Android SDK (platforms;android-34, build-tools;35.0.0).
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(pwd)"

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/opt/android-sdk}}"
BT_VER="${BUILD_TOOLS:-35.0.0}"
BT="$SDK/build-tools/$BT_VER"
PLATFORM="$SDK/platforms/android-34/android.jar"
VERSION_NAME="${VERSION_NAME:-1.0.0}"
VERSION_CODE="${VERSION_CODE:-1}"
KEYSTORE="${KEYSTORE:-$ROOT/android/rialto-release.keystore}"
KS_PASS="${KS_PASS:-rialto2026}"
KS_ALIAS="${KS_ALIAS:-rialto}"
OUT_DIR="$ROOT/apk"
OUT="$OUT_DIR/Rialto.apk"
B="$ROOT/build"

for f in "$BT/aapt2" "$BT/d8" "$BT/zipalign" "$BT/apksigner" "$PLATFORM"; do
  [ -e "$f" ] || { echo "Не найдено: $f (установите Android SDK: platforms;android-34 и build-tools;$BT_VER)"; exit 1; }
done

echo "==> Сборка веб-части"
pushd web >/dev/null
[ -d node_modules ] || npm ci --no-audit --no-fund
npm run build --silent
popd >/dev/null

echo "==> Подготовка"
rm -rf "$B"
mkdir -p "$B/gen" "$B/obj" "$B/dex" "$B/assets/www" "$OUT_DIR"
cp -r web/dist/. "$B/assets/www/"

echo "==> Ресурсы (aapt2)"
"$BT/aapt2" compile --dir android/res -o "$B/res.zip"
"$BT/aapt2" link -I "$PLATFORM" --manifest android/AndroidManifest.xml -o "$B/unsigned.apk" \
  -A "$B/assets" --java "$B/gen" "$B/res.zip" \
  --min-sdk-version 21 --target-sdk-version 34 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" --auto-add-overlay

echo "==> Java"
find android/src "$B/gen" -name '*.java' > "$B/sources.txt"
javac -nowarn -encoding UTF-8 -source 8 -target 8 -Xlint:-options -classpath "$PLATFORM" -d "$B/obj" @"$B/sources.txt"

echo "==> DEX (d8)"
"$BT/d8" --release --min-api 21 --lib "$PLATFORM" --output "$B/dex" $(find "$B/obj" -name '*.class')
(cd "$B/dex" && zip -q -u "$B/unsigned.apk" classes.dex)

echo "==> Выравнивание и подпись"
"$BT/zipalign" -p -f 4 "$B/unsigned.apk" "$B/aligned.apk"
"$BT/apksigner" sign --ks "$KEYSTORE" --ks-pass "pass:$KS_PASS" --ks-key-alias "$KS_ALIAS" --key-pass "pass:$KS_PASS" --out "$OUT" "$B/aligned.apk"
"$BT/apksigner" verify "$OUT"
rm -f "$OUT.idsig"
echo "==> Готово: $OUT ($(du -h "$OUT" | cut -f1))"
