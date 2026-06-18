#requires -Version 5
<#
.SYNOPSIS
  Hot-redeploys the freshly built add-in DLL into the install dir without a full reinstall.

.DESCRIPTION
  SolidWorks locks Facet.AddIn.dll while it's loaded, so this waits for SolidWorks to close,
  copies the new DLL (+pdb) into C:\Program Files\Facet\addin, and writes a done-marker. Run
  elevated (it writes to Program Files). Used for fast add-in iteration.
#>
param(
  [string]$Source  = "$PSScriptRoot\..\addin\bin\x64\Release\net48",
  [string]$Dest    = "C:\Program Files\Facet\addin",
  [int]   $TimeoutSec = 600
)
$ErrorActionPreference = "Stop"
$marker = Join-Path $env:TEMP "facet-redeploy.status"
Set-Content $marker "waiting"

Write-Host "================ Facet add-in redeploy ================" -ForegroundColor Cyan
Write-Host "Please CLOSE SolidWorks now (save your work first)."     -ForegroundColor Yellow
Write-Host "This window will swap in the new add-in automatically, then you can reopen SolidWorks."

$deadline = (Get-Date).AddSeconds($TimeoutSec)
while (Get-Process SLDWORKS -ErrorAction SilentlyContinue) {
  if ((Get-Date) -gt $deadline) {
    Set-Content $marker "timeout"
    Write-Host "Timed out waiting for SolidWorks to close." -ForegroundColor Red
    Start-Sleep 4; exit 1
  }
  Start-Sleep -Seconds 1
}

Start-Sleep -Seconds 1  # let the file lock release
Copy-Item (Join-Path $Source "Facet.AddIn.dll") (Join-Path $Dest "Facet.AddIn.dll") -Force
Copy-Item (Join-Path $Source "Facet.AddIn.pdb") (Join-Path $Dest "Facet.AddIn.pdb") -Force -ErrorAction SilentlyContinue
Set-Content $marker "deployed $(Get-Date -Format o)"

Write-Host "`nNew add-in deployed. You can REOPEN SolidWorks now." -ForegroundColor Green
Start-Sleep -Seconds 3
