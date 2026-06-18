using System;
using SolidWorks.Interop.sldworks;
using SolidWorks.Interop.swcommands;

namespace Facet.AddIn
{
    /// <summary>
    /// Runs SolidWorks commands on behalf of key presses. Resolves a <c>swCommands_e</c> enum name
    /// to its integer id (with a raw-id fallback), then calls <see cref="ISldWorks.RunCommand"/> on
    /// the SolidWorks main thread — i.e. it "presses the button the user would press".
    /// </summary>
    internal sealed class CommandRunner
    {
        private readonly ISldWorks _app;
        private readonly MainThreadDispatcher _dispatcher;
        private readonly Action<string> _log;

        public CommandRunner(ISldWorks app, MainThreadDispatcher dispatcher, Action<string> log)
        {
            _app = app;
            _dispatcher = dispatcher;
            _log = log;
        }

        /// <summary>
        /// Resolve and dispatch the command. Returns true once the command is handed to the
        /// SolidWorks thread (RunCommand runs asynchronously there and may block on its own UI, so
        /// we must NOT wait on it from the WebSocket thread). The actual RunCommand result is logged.
        /// </summary>
        public bool Run(InboundMessage invoke)
        {
            if (!TryResolveCommandId(invoke, out int id))
            {
                _log($"Facet: command not resolved: '{invoke.Command}' (commandId={invoke.CommandId})");
                return false;
            }

            _log($"Facet: dispatching '{invoke.Command}' (id={id}) to SolidWorks thread");
            _dispatcher.Post(() =>
            {
                try
                {
                    // Returns false if the command id is unknown or currently unavailable.
                    bool ok = _app.RunCommand(id, string.Empty);
                    _log($"Facet: RunCommand('{invoke.Command}', id={id}) returned {ok}");
                }
                catch (Exception ex)
                {
                    _log($"Facet: RunCommand('{invoke.Command}', id={id}) threw: {ex.Message}");
                }
            });
            return true; // dispatched; execution happens asynchronously on the UI thread
        }

        private static bool TryResolveCommandId(InboundMessage invoke, out int id)
        {
            // Prefer a named swCommands_e value; fall back to a raw integer id from the catalog.
            if (!string.IsNullOrEmpty(invoke.Command)
                && Enum.TryParse(invoke.Command, ignoreCase: false, out swCommands_e parsed))
            {
                id = (int)parsed;
                return true;
            }
            if (invoke.CommandId.HasValue)
            {
                id = invoke.CommandId.Value;
                return true;
            }
            id = 0;
            return false;
        }
    }
}
