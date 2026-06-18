using System;
using System.Runtime.InteropServices;
using Microsoft.Win32;
using SolidWorks.Interop.sldworks;
using SolidWorks.Interop.swpublished;

namespace Facet.AddIn
{
    /// <summary>
    /// Facet — the SolidWorks add-in entry point. On connect it stands up the WebSocket server the
    /// Stream Deck plugin talks to, starts watching SolidWorks context, and routes key presses back
    /// into SolidWorks commands.
    /// </summary>
    [ComVisible(true)]
    [Guid(AddInGuid)]
    [ProgId("Facet.AddIn")]
    public sealed class FacetAddin : ISwAddin
    {
        public const string AddInGuid = "F6A1C2D3-8B4E-4C9A-9E21-7D5B3A0C1E45";
        private const string Title = "Facet";
        private const string Description = "Context-aware Stream Deck companion for SolidWorks.";

        private ISldWorks? _app;
        private int _cookie;
        private MainThreadDispatcher? _dispatcher;
        private WsServer? _server;
        private ContextEngine? _engine;

        private static string Version =>
            typeof(FacetAddin).Assembly.GetName().Version?.ToString() ?? "0.1.0";

        /* ---- ISwAddin ---- */

        public bool ConnectToSW(object ThisSW, int Cookie)
        {
            _app = (ISldWorks)ThisSW;
            _cookie = Cookie;
            // Note: SetAddinCallbackInfo2 is wired up in a later phase, when Facet adds its own
            // toolbar/menu commands that need SolidWorks to call back into the add-in.

            try
            {
                // Marshaler must be created on this (SolidWorks main/STA) thread.
                _dispatcher = new MainThreadDispatcher();
                var runner = new CommandRunner(_app, _dispatcher);

                _server = new WsServer
                {
                    OnInvoke = runner.Run,
                    Log = LogToSolidWorks,
                };
                _server.Start(Version);

                _engine = new ContextEngine(_app, _dispatcher, OnContextChanged);
                _engine.Start();

                LogToSolidWorks("Facet connected.");
                return true;
            }
            catch (Exception ex)
            {
                LogToSolidWorks("Facet failed to start: " + ex.Message);
                return false;
            }
        }

        public bool DisconnectFromSW()
        {
            try { _engine?.Stop(); } catch { }
            try { _server?.Dispose(); } catch { }
            try { _dispatcher?.Dispose(); } catch { }

            _engine = null;
            _server = null;
            _dispatcher = null;
            _app = null;

            GC.Collect();
            GC.WaitForPendingFinalizers();
            return true;
        }

        private void OnContextChanged(ContextState state)
        {
            // Runs off the SolidWorks thread; WsServer broadcast is thread-safe.
            _server?.BroadcastContext(WireProtocol.Context(state));
        }

        private static void LogToSolidWorks(string message)
        {
            // Quiet, non-intrusive logging: debug output + a temp log file for field diagnosis.
            // (A status-bar/notification sink can layer in during the Phase 3 polish pass.)
            string line = $"{DateTime.Now:HH:mm:ss.fff}  {message}";
            System.Diagnostics.Debug.WriteLine("[Facet] " + line);
            try
            {
                string path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "Facet.log");
                System.IO.File.AppendAllText(path, line + Environment.NewLine);
            }
            catch { }
        }

        /* ---- COM registration (RegAsm calls these) ---- */

        [ComRegisterFunction]
        public static void RegisterFunction(Type t)
        {
            try
            {
                string guid = "{" + t.GUID.ToString().ToUpperInvariant() + "}";

                using (var addinKey = Registry.LocalMachine.CreateSubKey($@"SOFTWARE\SolidWorks\AddIns\{guid}"))
                {
                    // HKLM (default) DWORD = 0 per the canonical add-in template: the machine-wide
                    // entry registers the add-in; whether it auto-loads is the per-user HKCU toggle
                    // below. (Setting HKLM = 1 would force-load for every user and fight HKCU.)
                    addinKey?.SetValue(null, 0, RegistryValueKind.DWord);
                    addinKey?.SetValue("Title", Title);
                    addinKey?.SetValue("Description", Description);
                }

                using (var startupKey = Registry.CurrentUser.CreateSubKey($@"Software\SolidWorks\AddInsStartup\{guid}"))
                {
                    // Per-user enable toggle (the checkbox in Tools ▸ Add-Ins).
                    startupKey?.SetValue(null, 1, RegistryValueKind.DWord);
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("Facet registration failed: " + ex.Message);
                throw;
            }
        }

        [ComUnregisterFunction]
        public static void UnregisterFunction(Type t)
        {
            try
            {
                string guid = "{" + t.GUID.ToString().ToUpperInvariant() + "}";
                Registry.LocalMachine.DeleteSubKey($@"SOFTWARE\SolidWorks\AddIns\{guid}", throwOnMissingSubKey: false);
                Registry.CurrentUser.DeleteSubKey($@"Software\SolidWorks\AddInsStartup\{guid}", throwOnMissingSubKey: false);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("Facet unregistration failed: " + ex.Message);
            }
        }
    }
}
