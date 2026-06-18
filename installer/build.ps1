#requires -Version 5
<#
.SYNOPSIS
  Builds the Facet installer end to end: plugin -> .streamDeckPlugin -> add-in -> Setup.exe.

.DESCRIPTION
  Run from anywhere:  pwsh installer\build.ps1
  Prerequisites:
    • Node.js 20+ and npm                    (plugin build + pack)
    • @elgato/cli  (npm i -g @elgato/cli)    (streamdeck pack)
    • .NET SDK / MSBuild + SolidWorks        (add-in build — interop assemblies)
    • Inno Setup 6 (ISCC.exe)                (compile the installer)

  The SolidWorks install is auto-detected from the registry (any installed version/path). Use
  -SolidWorksPath to override, or -SkipAddin to build/pack only the plugin.

.PARAMETER SkipAddin
  Skip compiling the SolidWorks add-in (no SolidWorks on this machine).

.PARAMETER Configuration
  Build configuration for the add-in (default: Release).

.PARAMETER SolidWorksPath
  Override the auto-detected SolidWorks install folder (the one containing api\redist).
#>
param(
  [switch]$SkipAddin,
  [string]$Configuration = "Release",
  [string]$SolidWorksPath
)

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$root = Split-Path $here -Parent
$out  = Join-Path $here "out"

function Step($m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Need($name, $hint) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) { throw "'$name' not found. $hint" }
}

# Locate a SolidWorks install whose api\redist has the interop assemblies we reference.
function Find-SolidWorksPath {
  param([string]$Override)
  $probe = "api\redist\SolidWorks.Interop.sldworks.dll"

  if ($Override) {
    if (Test-Path (Join-Path $Override $probe)) { return $Override.TrimEnd('\') }
    throw "SolidWorksPath '$Override' does not contain $probe."
  }

  # Registry: newest "SOLIDWORKS <year>" key -> its 'SolidWorks Folder' install path.
  $base = "HKLM:\SOFTWARE\SolidWorks"
  if (Test-Path $base) {
    $versions = Get-ChildItem $base -ErrorAction SilentlyContinue |
      Where-Object { $_.PSChildName -match '^SOLIDWORKS \d{4}$' } |
      Sort-Object { [int]($_.PSChildName -replace '\D', '') } -Descending
    foreach ($v in $versions) {
      $folder = (Get-ItemProperty -Path "$($v.PSPath)\Setup" -Name 'SolidWorks Folder' -ErrorAction SilentlyContinue).'SolidWorks Folder'
      if ($folder) {
        $folder = $folder.TrimEnd('\')
        if (Test-Path (Join-Path $folder $probe)) {
          Write-Host "  Detected $($v.PSChildName) at $folder" -ForegroundColor DarkGray
          return $folder
        }
      }
    }
  }

  # Fallback: common install locations.
  foreach ($c in @(
      "C:\Program Files\SOLIDWORKS Corp\SOLIDWORKS",
      "C:\Program Files\SOLIDWORKS Corp\SOLIDWORKS (3)")) {
    if (Test-Path (Join-Path $c $probe)) { return $c }
  }
  return $null
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

# 3. Build the SolidWorks add-in against the locally installed interop assemblies.
$addinDir = $null
if ($SkipAddin) {
  Write-Warning "Skipping add-in build (-SkipAddin). Facet.AddIn.dll will be missing, so the installer step will fail by design."
} else {
  Step "Building SolidWorks add-in ($Configuration)"
  Need dotnet "Install the .NET SDK from https://dotnet.microsoft.com"
  $sw = Find-SolidWorksPath -Override $SolidWorksPath
  if (-not $sw) {
    throw "Could not locate a SolidWorks install with api\redist. Install SolidWorks, or pass -SolidWorksPath '<...\SOLIDWORKS>'."
  }
  Write-Host "  Using SolidWorks: $sw"
  # MSBuild reads SolidWorksPath from the environment (the csproj only defaults it when empty).
  $env:SolidWorksPath = $sw
  dotnet build (Join-Path $root "addin\Facet.AddIn.csproj") -c $Configuration -p:Platform=x64

  $dll = Get-ChildItem (Join-Path $root "addin\bin") -Recurse -Filter "Facet.AddIn.dll" -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match [regex]::Escape("\$Configuration\") } | Select-Object -First 1
  if (-not $dll) { throw "Add-in build succeeded but Facet.AddIn.dll was not found under addin\bin." }
  $addinDir = $dll.DirectoryName
  Write-Host "  Add-in output: $addinDir"
}

# 4. Compile the installer with Inno Setup.
Step "Compiling installer"
$isccCmd = Get-Command ISCC.exe -ErrorAction SilentlyContinue
$iscc = if ($isccCmd) { $isccCmd.Source } else { $null }
if (-not $iscc) {
  $iscc = @(
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $iscc) { throw "Inno Setup 6 (ISCC.exe) not found. Install it: winget install JRSoftware.InnoSetup" }

$isccArgs = @()
if ($addinDir) { $isccArgs += "/DAddinDir=$addinDir" }
$isccArgs += (Join-Path $here "Facet.iss")
& $iscc @isccArgs

Step "Done"
$setup = Get-ChildItem $out -Filter "Facet-Setup-*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($setup) { Write-Host "Installer: $($setup.FullName)" -ForegroundColor Green }
else { Write-Warning "Installer compile finished but no Facet-Setup-*.exe found in $out." }
