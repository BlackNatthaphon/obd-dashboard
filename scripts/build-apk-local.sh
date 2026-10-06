#!/usr/bin/env bash
# Build the APK without Gradle / Google's Android SDK, using Ubuntu's Android tools.
# Use this when GitHub Actions can't run. Ubuntu 24.04, run as root:
#   scripts/build-apk-local.sh [versionCode] [versionName]
# Output: build/local/obd-dashboard.apk
set -euo pipefail
cd "$(dirname "$0")/.."
VC=${1:-5}
VN=${2:-2.0.$VC}
OUT=build/local
DL=build/local-deps
SRC=app/src/main
mkdir -p "$DL"

if ! command -v aapt >/dev/null || ! command -v dalvik-exchange >/dev/null || [ ! -f /usr/lib/android-sdk/platforms/android-23/android.jar ] || [ ! -x /usr/lib/jvm/java-8-openjdk-amd64/bin/java ]; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq aapt apksigner zipalign dalvik-exchange \
    android-framework-res android-sdk-platform-23 openjdk-8-jdk-headless >/dev/null
fi
# Android 14 classes to compile against, and retrolambda to turn lambdas into classes the old dx accepts
[ -f "$DL/android-all.jar" ] || curl -sSfL -o "$DL/android-all.jar" \
  https://repo1.maven.org/maven2/org/robolectric/android-all/14-robolectric-10818077/android-all-14-robolectric-10818077.jar
[ -f "$DL/retrolambda.jar" ] || curl -sSfL -o "$DL/retrolambda.jar" \
  https://repo1.maven.org/maven2/net/orfjackal/retrolambda/retrolambda/2.5.7/retrolambda-2.5.7.jar

rm -rf "$OUT" && mkdir -p "$OUT/gen" "$OUT/classes" "$OUT/classes2"
sed 's|<manifest |<manifest package="digital.blacktech.obd" |' $SRC/AndroidManifest.xml > "$OUT/AndroidManifest.xml"
aapt package -f -m -J "$OUT/gen" -M "$OUT/AndroidManifest.xml" -S $SRC/res -A $SRC/assets \
  -I /usr/share/android-framework-res/framework-res.apk -F "$OUT/unsigned.apk" \
  --min-sdk-version 26 --target-sdk-version 34 --version-code "$VC" --version-name "$VN"
javac --release 8 -nowarn -encoding UTF-8 -cp "$DL/android-all.jar" -d "$OUT/classes" \
  "$OUT/gen/digital/blacktech/obd/R.java" $(find $SRC/java -name '*.java')
/usr/lib/jvm/java-8-openjdk-amd64/bin/java -Dretrolambda.inputDir="$OUT/classes" \
  -Dretrolambda.classpath="$OUT/classes:/usr/lib/android-sdk/platforms/android-23/android.jar" \
  -Dretrolambda.outputDir="$OUT/classes2" -javaagent:"$DL/retrolambda.jar" -jar "$DL/retrolambda.jar" >/dev/null
dalvik-exchange --dex --min-sdk-version=26 --output="$OUT/classes.dex" "$OUT/classes2"
(cd "$OUT" && aapt add unsigned.apk classes.dex >/dev/null)
zipalign -f -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"
apksigner sign --ks app/release.keystore --ks-key-alias obd --ks-pass pass:obd12345 --key-pass pass:obd12345 \
  --min-sdk-version 26 --out "$OUT/obd-dashboard.apk" "$OUT/aligned.apk"
apksigner verify "$OUT/obd-dashboard.apk"
echo "Built $OUT/obd-dashboard.apk ($VN)"
