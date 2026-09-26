#!/bin/bash
# ─── بازسازی تولچِین بیلد اندروید (JDK17 + cmdline-tools + SDK + gradle) ───
# خروجی: /tmp/toolchain/{jdk17,android-sdk,gradle-8.7}
set -x
mkdir -p /tmp/toolchain
cd /tmp/toolchain

# 1) JDK 17 (Temurin)
if [ ! -d jdk17 ]; then
  curl -sL --retry 3 -o jdk17.tar.gz "https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jdk/hotspot/normal/eclipse"
  mkdir -p jdk17 && tar -xzf jdk17.tar.gz -C jdk17 --strip-components=1
  rm -f jdk17.tar.gz
fi
echo "JDK_DONE $(ls jdk17/bin/java)"

# 2) Android cmdline-tools + SDK
if [ ! -d android-sdk/cmdline-tools/latest ]; then
  curl -sL --retry 3 -o cmdtools.zip "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
  mkdir -p android-sdk/cmdline-tools
  unzip -q cmdtools.zip -d android-sdk/cmdline-tools
  mv android-sdk/cmdline-tools/cmdline-tools android-sdk/cmdline-tools/latest
  rm -f cmdtools.zip
fi
export JAVA_HOME=/tmp/toolchain/jdk17
export ANDROID_HOME=/tmp/toolchain/android-sdk
export PATH=$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH

yes | sdkmanager --licenses > /dev/null 2>&1
sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0" > /dev/null 2>&1
echo "SDK_DONE"

# 3) Gradle 8.7
if [ ! -d gradle-8.7 ]; then
  curl -sL --retry 3 -o gradle.zip "https://services.gradle.org/distributions/gradle-8.7-bin.zip"
  unzip -q gradle.zip
  rm -f gradle.zip
fi
echo "GRADLE_DONE $(ls -d gradle-8.7)"

echo "TOOLCHAIN_READY"
