# Build a personal Android APK for Warikan Master via EAS (Expo cloud build).
#
# Usage (PowerShell):
#   cd C:\Users\str06\private_workplace\warikan_master\mobile
#   ./build-apk.ps1
#
# What it does:
#   1. Puts the portable Node on PATH (this PC has no system Node).
#   2. Logs you in to your free Expo account (first run only).
#   3. Triggers a cloud APK build (profile "preview" in eas.json).
#      When it finishes, the CLI prints a download URL for the .apk.
#
# Then: open that URL on your Android phone, download the APK, and install it
# (you may need to allow "install unknown apps" for your browser).
# The app talks to the live backend at https://warikan-master.onrender.com.

$ErrorActionPreference = "Stop"

$nodeDir = "C:\Users\str06\private_workplace\yosakoi_formation\.tooling\node-v24.16.0-win-x64"
if (-not (Test-Path "$nodeDir\node.exe")) {
    throw "Portable Node not found at $nodeDir"
}
$env:Path = "$nodeDir;$env:Path"
Set-Location -Path $PSScriptRoot

Write-Host "Node: $(node -v)"
Write-Host "Logging in to Expo (free account; opens a prompt on first run)..."
npx eas-cli@latest login

Write-Host "Starting Android APK cloud build (profile: preview)..."
npx eas-cli@latest build --platform android --profile preview
