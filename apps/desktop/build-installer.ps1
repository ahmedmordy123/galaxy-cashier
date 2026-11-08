#Requires -Version 5.1
# Builds the client NSIS installer: Next → Next → Finish (desktop shortcut).
& (Join-Path $PSScriptRoot 'build.ps1') -InstallerOnly
