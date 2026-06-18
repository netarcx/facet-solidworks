; Facet for SolidWorks — Inno Setup installer
;
; Builds a single Setup.exe that installs both halves and wires them up:
;   • copies + COM-registers the SolidWorks add-in (RegAsm /codebase, 64-bit)
;   • installs the Stream Deck plugin (hands the .streamDeckPlugin to the Stream Deck app)
;
; Build it via installer\build.ps1 (recommended), or directly with:
;   "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer\Facet.iss
; (after building the add-in and packing the plugin — both are prerequisites; see build.ps1).

#define AppName "Facet for SolidWorks"
#define AppVersion "0.2.0"
#define AppPublisher "SW Robotics"
#define AppURL "https://github.com/netarcx/facet-solidworks"
#define AddinDll "Facet.AddIn.dll"
#define PluginFile "com.swrobotics.facet.streamDeckPlugin"
; AddinDir can be overridden by build.ps1 (ISCC /DAddinDir=...) with the real build output dir.
#ifndef AddinDir
  #define AddinDir "..\addin\bin\x64\Release\net48"
#endif
#define OutDir "out"

[Setup]
AppId={{B2E4F1A6-9C3D-4E8B-A7F2-1D0C5B9E3A47}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}
DefaultDirName={autopf}\Facet
DisableProgramGroupPage=yes
DisableDirPage=auto
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\addin\{#AddinDll}
OutputDir={#OutDir}
OutputBaseFilename=Facet-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; Admin is required: RegAsm writes HKLM and files land in Program Files.
PrivilegesRequired=admin

[Files]
; The compiled add-in + its dependencies (Newtonsoft.Json.dll). The SolidWorks interop assemblies
; are intentionally NOT bundled — they come from the user's SolidWorks install at runtime.
Source: "{#AddinDir}\*"; DestDir: "{app}\addin"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#OutDir}\{#PluginFile}"; DestDir: "{app}\plugin"; Flags: ignoreversion

[Run]
; Register the add-in for COM so SolidWorks discovers and loads it.
Filename: "{dotnet4064}\RegAsm.exe"; \
  Parameters: "/codebase ""{app}\addin\{#AddinDll}"""; \
  StatusMsg: "Registering Facet with SolidWorks…"; Flags: runhidden

; Install the Stream Deck plugin: opening the .streamDeckPlugin hands it to the Stream Deck app,
; which installs it. Optional checkbox on the finish page (needs the Stream Deck app present).
Filename: "{app}\plugin\{#PluginFile}"; \
  Description: "Install the Facet Stream Deck plugin now"; \
  Flags: shellexec postinstall skipifsilent

[UninstallRun]
Filename: "{dotnet4064}\RegAsm.exe"; \
  Parameters: "/unregister ""{app}\addin\{#AddinDll}"""; \
  Flags: runhidden; RunOnceId: "UnregisterFacet"

[Messages]
FinishedHeadingLabel=Facet is ready.
FinishedLabelNoIcons=Open SolidWorks and confirm Facet under Tools ▸ Add-Ins. Your Stream Deck then follows along automatically — Part, Sketch, Assembly, and Drawing tools appear as you work.
FinishedLabel=Open SolidWorks and confirm Facet under Tools ▸ Add-Ins. Your Stream Deck then follows along automatically as you work.

[Code]
function SolidWorksInstalled(): Boolean;
begin
  Result := RegKeyExists(HKLM, 'SOFTWARE\SolidWorks') or
            RegKeyExists(HKLM, 'SOFTWARE\Wow6432Node\SolidWorks') or
            RegKeyExists(HKLM, 'SOFTWARE\SOLIDWORKS Corp');
end;

function InitializeSetup(): Boolean;
begin
  Result := True;
  if not SolidWorksInstalled() then
  begin
    if MsgBox('SolidWorks was not detected on this PC.' + #13#10 + #13#10 +
              'Facet needs SolidWorks 2026 to do its thing. You can install Facet now and add ' +
              'SolidWorks later.' + #13#10 + #13#10 +
              'Continue with installation?', mbConfirmation, MB_YESNO) = IDNO then
      Result := False;
  end;
end;
