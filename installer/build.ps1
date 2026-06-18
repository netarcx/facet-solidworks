#requires -Version 5
<#
.SYNOPSIS
  Builds the Facet installer end to end: plugin -> .streamDeckPlugin -> add-in -> Setup.exe.

.DESCRIPTION
  Run from anywhere:  pwsh installer\build.ps1
  Prerequisites:
    • Node.js 20+ and npm                    (plugin build + pack)
    • @elgato/cli  (npm i -g @elgato/cli)    (streamdeck pack)
    • .NET SDK / MSBuild + SolidWorks 2026   (add-in build — interop assemblies)
    • Inno Setup 6 (ISCC.exe)                (compile the installer)

  Use -SkipAddin to build/pack only the plugin (e.g. on a machine without SolidWorks); the
  installer step will then fail intentionally because Facet.AddIn.dll is required.

.PARAMETER SkipAddin
  Skip compiling the SolidWorks add-in (no SolidWorks on this machine).

.PARAMETER Configuration
  Build configuration for the add-in (default: Release).
#>
param(
  [switch]$SkipAddin,
  [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$root = Split-Path $here -Parent
$out  = Join-Path $here "out"

function Step($m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Need($name, $hint) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) { throw "'$name' not found. $hint" }
}

New-Item -ItemType Directory -Force -Path $out | Out-Null

# 1. Plugin: install deps, generate icons, build the bundle.
Step "Building Stream Deck plugin"
Need npm "Install Node.js 20+ from https://nodejs.org"
Push-Location (Join-Path $root "plugin")
try {
  npm install
  npm run icons
  npm run build
} finally { Pop-Location }

# 2. Pack the .streamDeckPlugin (also validates the manifest + icons).
Step "Packing .streamDeckPlugin"
Need streamdeck "Install the Elgato CLI: npm i -g @elgato/cli"
streamdeck pack (Join-Path $root "plugin\com.swrobotics.facet.sdPlugin") --output $out --force

# 3. Build the SolidWorks add-in (needs the interop assemblies from a SolidWorks install).
if ($SkipAddin) {
  Write-Warning "Skipping add-in build (-SkipAddin). Facet.AddIn.dll will be missing, so the installer step will fail by design."
} else {
  Step "Building SolidWorks add-in ($Configuration)"
  Need dotnet "Install the .NET SDK from https://dotnet.microsoft.com — and run this on a machine with SolidWorks 2026."
  dotnet build (Join-Path $root "addin\Facet.AddIn.csproj") -c $Configuration
}

# 4. Compile the installer with Inno Setup.
Step "Compiling installer"
$isccCmd = Get-Command ISCC.exe -ErrorAction SilentlyContinue
$iscc = if ($isccCmd) { $isccCmd.Source } else { $null }
if (-not $iscc) {
  $iscc = @(
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $iscc) { throw "Inno Setup 6 (ISCC.exe) not found. Install it from https://jrsoftware.org/isdl.php" }
& $iscc (Join-Path $here "Facet.iss")

Step "Done"
Write-Host "Installer written to: $out" -ForegroundColor Green
Get-ChildItem $out -Filter "Facet-Setup-*.exe" | ForEach-Object { Write-Host "  $($_.FullName)" }
