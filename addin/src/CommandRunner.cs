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

        public CommandRunner(ISldWorks app, MainThreadDispatcher dispatcher)
        {
            _app = app;
            _dispatcher = dispatcher;
        }

        /// <summary>Resolve and run the command described by an inbound invoke. Returns success.</summary>
        public bool Run(InboundMessage invoke)
        {
            if (!TryResolveCommandId(invoke, out int id)) return false;

            // RunCommand must run on the STA thread that owns the SolidWorks app object.
            return _dispatcher.Invoke(() =>
            {
                try
                {
                    // Returns false if the command id is unknown or currently unavailable.
                    return _app.RunCommand(id, string.Empty);
                }
                catch
                {
                    return false;
                }
            });
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
