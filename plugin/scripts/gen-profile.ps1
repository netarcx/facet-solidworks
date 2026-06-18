#requires -Version 5
<#
  Generates Facet.streamDeckProfile — a profile that fills all 15 keys of a 15-key Stream Deck
  (MK.2 / original, DeviceType 0) with the FacetKey action, so a fresh install lays out the whole
  deck automatically instead of the user hand-placing keys.

  Output: <plugin>/Facet.streamDeckProfile  (a zip of <uuid>.sdProfile/...), referenced from the
  manifest's Profiles[]. Mirrors the ProfilesV3 on-disk format.
#>
param([string]$PluginDir = "$PSScriptRoot\..\com.swrobotics.facet.sdPlugin")
$ErrorActionPreference = "Stop"

$profUuid = "FACE7000-0000-4000-8000-000000000001"
$pageUuid = "FACE7000-0000-4000-8000-000000000002"
$pageLower = $pageUuid.ToLower()

# One FacetKey action per key. Coordinates are "col,row" across a 5x3 grid.
$actions = [ordered]@{}
foreach ($row in 0..2) {
  foreach ($col in 0..4) {
    $actions["$col,$row"] = [ordered]@{
      ActionID    = [guid]::NewGuid().ToString()
      LinkedTitle = $true
      Name        = "Facet Key"
      Plugin      = [ordered]@{ Name = "Facet for SolidWorks"; UUID = "com.swrobotics.facet"; Version = "0.2.0.0" }
      Resources   = $null
      Settings    = @{}
      State       = 0
      States      = @([ordered]@{
          FontFamily = ""; FontSize = 12; FontStyle = ""; FontUnderline = $false
          OutlineThickness = 2; ShowTitle = $false; TitleAlignment = "bottom"; TitleColor = "#ffffff"
        })
      UUID        = "com.swrobotics.facet.key"
    }
  }
}

$pageManifest = [ordered]@{ Controllers = @([ordered]@{ Actions = $actions }) }
$topManifest = [ordered]@{
  Name    = "Facet"
  Version = "3.0"
  Pages   = [ordered]@{ Current = $pageLower; Default = $pageLower; Pages = @($pageLower) }
}

# Build the folder structure in a temp dir.
$work = Join-Path $env:TEMP "facet-profile-$([guid]::NewGuid())"
$prof = Join-Path $work "$profUuid.sdProfile"
$pageDir = Join-Path $prof "Profiles\$pageUuid"
New-Item -ItemType Directory -Force -Path $pageDir | Out-Null

$topManifest  | ConvertTo-Json -Depth 12 -Compress | Set-Content (Join-Path $prof "manifest.json") -Encoding UTF8
$pageManifest | ConvertTo-Json -Depth 12 -Compress | Set-Content (Join-Path $pageDir "manifest.json") -Encoding UTF8

# Zip the .sdProfile folder (at archive root) and name it .streamDeckProfile.
$out = Join-Path $PluginDir "Facet.streamDeckProfile"
if (Test-Path $out) { Remove-Item $out -Force }
$zip = Join-Path $work "Facet.zip"
Compress-Archive -Path $prof -DestinationPath $zip -Force
Move-Item $zip $out -Force
Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "Wrote $out"
