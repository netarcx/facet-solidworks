using System;
using SolidWorks.Interop.sldworks;
using SolidWorks.Interop.swcommands;
using SolidWorks.Interop.swconst;

namespace Facet.AddIn
{
    /// <summary>
    /// Runs the action behind a key press on the SolidWorks (STA) thread and reports the real
    /// result back via a callback. Two kinds of action:
    ///  • <c>facet:*</c> — handled directly through the API (e.g. creating new documents, which
    ///    <see cref="ISldWorks.RunCommand"/> can't do reliably).
    ///  • <c>swCommands_*</c> — resolved to a <c>swCommands_e</c> id and run via RunCommand, i.e.
    ///    "press the button the user would press".
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

        /// <summary>Dispatch the action; <paramref name="reply"/> is called with the real outcome.</summary>
        public void Run(InboundMessage invoke, Action<bool, string?> reply)
        {
            var command = invoke.Command;

            if (!string.IsNullOrEmpty(command) && command!.StartsWith("facet:", StringComparison.Ordinal))
            {
                if (!_dispatcher.Post(() => SafeReply(reply, () => RunFacetAction(command), command)))
                    reply(false, "SolidWorks is busy or shutting down");
                return;
            }

            if (!TryResolveCommandId(invoke, out int id))
            {
                _log($"Facet: command not resolved: '{command}' (commandId={invoke.CommandId})");
                reply(false, $"Unknown command '{command}'");
                return;
            }

            _log($"Facet: dispatching '{command}' (id={id}) to SolidWorks thread");
            // Guarantee a reply: if the work can't be marshaled, the plugin would otherwise wait
            // out its full timeout.
            if (!_dispatcher.Post(() => SafeReply(reply, () =>
            {
                // Returns false when the command is unavailable in the current context.
                bool ok = _app.RunCommand(id, string.Empty);
                _log($"Facet: RunCommand('{command}', id={id}) returned {ok}");
                return ok;
            }, command)))
            {
                reply(false, "SolidWorks is busy or shutting down");
            }
        }

        /// <summary>Runs <paramref name="action"/> on the UI thread and replies, never throwing out.</summary>
        private void SafeReply(Action<bool, string?> reply, Func<bool> action, string? label)
        {
            try
            {
                bool ok = action();
                reply(ok, ok ? null : "SolidWorks could not run this here");
            }
            catch (Exception ex)
            {
                _log($"Facet: action '{label}' threw: {ex.Message}");
                reply(false, ex.Message);
            }
        }

        /// <summary>Facet-native actions that don't map cleanly to a toolbar command.</summary>
        private bool RunFacetAction(string command)
        {
            switch (command)
            {
                case "facet:newPart": return NewDocument(swUserPreferenceStringValue_e.swDefaultTemplatePart);
                case "facet:newAssembly": return NewDocument(swUserPreferenceStringValue_e.swDefaultTemplateAssembly);
                case "facet:newDrawing": return NewDocument(swUserPreferenceStringValue_e.swDefaultTemplateDrawing);
                default:
                    _log($"Facet: unknown facet action '{command}'");
                    return false;
            }
        }

        /// <summary>Creates a new document from the user's default template for that doc type.</summary>
        private bool NewDocument(swUserPreferenceStringValue_e templatePref)
        {
            string template = _app.GetUserPreferenceStringValue((int)templatePref);
            if (string.IsNullOrEmpty(template))
            {
                // Surfaced to the deck so the user knows it's a one-time SolidWorks config issue.
                throw new InvalidOperationException(
                    $"No default {DocLabel(templatePref)} template set — pick one in SolidWorks ▸ Tools ▸ Options ▸ Default Templates.");
            }
            object doc = _app.NewDocument(template, 0, 0, 0);
            return doc != null;
        }

        private static string DocLabel(swUserPreferenceStringValue_e pref) => pref switch
        {
            swUserPreferenceStringValue_e.swDefaultTemplatePart => "Part",
            swUserPreferenceStringValue_e.swDefaultTemplateAssembly => "Assembly",
            swUserPreferenceStringValue_e.swDefaultTemplateDrawing => "Drawing",
            _ => "document",
        };

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
