#!/bin/bash
# v152 — بازسازی تولچِین اندروید با JDK سیستمی (21) — adoptium در سندباکس گیر می‌کند
set -x
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
export ANDROID_HOME=/tmp/toolchain/android-sdk
mkdir -p /tmp/toolchain/android-sdk/cmdline-tools
cd /tmp/toolchain

# 1) Android cmdline-tools (dl.google.com — در دسترس)
if [ ! -d android-sdk/cmdline-tools/latest ]; then
  curl -sL --retry 3 --max-time 300 -o cmdtools.zip "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
  unzip -q cmdtools.zip -d android-sdk/cmdline-tools
  mv android-sdk/cmdline-tools/cmdline-tools android-sdk/cmdline-tools/latest
  rm -f cmdtools.zip
fi
echo "CMDTOOLS_DONE"

export PATH=$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH
yes | sdkmanager --licenses > /dev/null 2>&1
sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0" > /dev/null 2>&1
echo "SDK_DONE"
ls android-sdk/platforms android-sdk/build-tools
echo "TOOLCHAIN_READY"
