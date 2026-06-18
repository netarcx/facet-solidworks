using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using SolidWorks.Interop.sldworks;
using SolidWorks.Interop.swcommands;
using SolidWorks.Interop.swconst;

namespace Facet.AddIn
{
    /// <summary>
    /// Watches SolidWorks for context changes (active document, sketch mode, selection, running
    /// command) and produces an immutable <see cref="ContextState"/>. All COM reads happen on the
    /// SolidWorks main thread inside event handlers; emissions are throttled so rapid selection
    /// churn doesn't flood the deck.
    /// </summary>
    internal sealed class ContextEngine : IDisposable
    {
        private const int MinIntervalMs = 40; // coalesce bursts to ~25 Hz max

        private readonly ISldWorks _app;
        private readonly SldWorks _sw;
        private readonly Action<ContextState> _onChanged;

        // App-level event handlers (kept as fields so we can detach the exact instances).
        private DSldWorksEvents_ActiveModelDocChangeNotifyEventHandler? _onActiveDocChange;
        private DSldWorksEvents_CommandOpenPreNotifyEventHandler? _onCommandOpen;
        private DSldWorksEvents_CommandCloseNotifyEventHandler? _onCommandClose;

        // The document we currently have selection handlers attached to, plus how to detach them.
        private object? _attachedDoc;
        private Action? _detachDocHandlers;

        private string? _activeCommand;

        // Throttle state. _clock is monotonic (Environment.TickCount wraps every ~25 days).
        private readonly object _gate = new object();
        private readonly Stopwatch _clock = Stopwatch.StartNew();
        private ContextState? _lastSent;
        private ContextState? _pending;
        private long _lastSendTicks;
        private Timer? _flushTimer;
        private bool _stopped;
        private bool _attaching;

        public ContextEngine(ISldWorks app, MainThreadDispatcher _, Action<ContextState> onChanged)
        {
            _app = app;
            _sw = (SldWorks)app;
            _onChanged = onChanged;
        }

        public void Start()
        {
            _onActiveDocChange = OnActiveModelDocChange;
            _onCommandOpen = OnCommandOpenPre;
            _onCommandClose = OnCommandClose;

            _sw.ActiveModelDocChangeNotify += _onActiveDocChange;
            _sw.CommandOpenPreNotify += _onCommandOpen;
            _sw.CommandCloseNotify += _onCommandClose;

            AttachActiveDoc();
            Touch(); // emit the initial context
        }

        public void Stop()
        {
            if (_onActiveDocChange != null) _sw.ActiveModelDocChangeNotify -= _onActiveDocChange;
            if (_onCommandOpen != null) _sw.CommandOpenPreNotify -= _onCommandOpen;
            if (_onCommandClose != null) _sw.CommandCloseNotify -= _onCommandClose;
            DetachDocHandlers();
            lock (_gate)
            {
                _stopped = true;
                _flushTimer?.Dispose();
                _flushTimer = null;
            }
        }

        /* ---- App event handlers (run on the SolidWorks STA thread) ---- */

        private int OnActiveModelDocChange()
        {
            AttachActiveDoc();
            Touch();
            return 0;
        }

        private int OnCommandOpenPre(int command, int userCommand)
        {
            // userCommand != 0 means one of *our* add-in commands; ignore those for context.
            if (userCommand == 0)
            {
                _activeCommand = Enum.GetName(typeof(swCommands_e), command);
                Touch();
            }
            return 0;
        }

        private int OnCommandClose(int command, int reason)
        {
            _activeCommand = null;
            Touch();
            return 0;
        }

        private int OnSelectionChanged() // shared by all doc types
        {
            Touch();
            return 0;
        }

        /* ---- Document attach/detach ---- */

        private void AttachActiveDoc()
        {
            // SolidWorks calls can pump messages, so an event could re-enter mid-attach. Guard it
            // so we never double-subscribe or leak a half-attached handler.
            if (_attaching) return;
            _attaching = true;
            try
            {
                AttachActiveDocCore();
            }
            finally { _attaching = false; }
        }

        private void AttachActiveDocCore()
        {
            object? doc = _app.ActiveDoc;
            if (ReferenceEquals(doc, _attachedDoc)) return;

            DetachDocHandlers();
            _attachedDoc = doc;
            if (doc == null) return;

            // Attach the NewSelectionNotify handler appropriate to the document type.
            if (doc is PartDoc part)
            {
                DPartDocEvents_NewSelectionNotifyEventHandler h = OnSelectionChanged;
                part.NewSelectionNotify += h;
                _detachDocHandlers = () => part.NewSelectionNotify -= h;
            }
            else if (doc is AssemblyDoc asm)
            {
                DAssemblyDocEvents_NewSelectionNotifyEventHandler h = OnSelectionChanged;
                asm.NewSelectionNotify += h;
                _detachDocHandlers = () => asm.NewSelectionNotify -= h;
            }
            else if (doc is DrawingDoc drw)
            {
                DDrawingDocEvents_NewSelectionNotifyEventHandler h = OnSelectionChanged;
                drw.NewSelectionNotify += h;
                _detachDocHandlers = () => drw.NewSelectionNotify -= h;
            }
        }

        private void DetachDocHandlers()
        {
            try { _detachDocHandlers?.Invoke(); } catch { /* doc already gone */ }
            _detachDocHandlers = null;
            _attachedDoc = null;
        }

        /* ---- State computation (STA) ---- */

        private ContextState Compute()
        {
            object? docObj = _app.ActiveDoc;
            if (docObj is not IModelDoc2 model) return WithCommand(ContextState.Empty);

            string docType =
                model is PartDoc ? "part" :
                model is AssemblyDoc ? "assembly" :
                model is DrawingDoc ? "drawing" : "none";

            bool inSketch = false;
            try { inSketch = model.SketchManager?.ActiveSketch != null; } catch { }

            int count = 0;
            var types = new List<string>();
            try
            {
                if (model.SelectionManager is ISelectionMgr selMgr)
                {
                    count = selMgr.GetSelectedObjectCount2(-1);
                    for (int i = 1; i <= count && i <= 8; i++)
                    {
                        int t = selMgr.GetSelectedObjectType3(i, -1);
                        types.Add(MapSelectType(t));
                    }
                }
            }
            catch { }

            string title = "";
            try { title = model.GetTitle() ?? ""; } catch { }

            return new ContextState(docType, inSketch, _activeCommand, count, types.ToArray(), title);
        }

        private ContextState WithCommand(ContextState s) =>
            _activeCommand == null
                ? s
                : new ContextState(s.DocType, s.InSketch, _activeCommand, s.SelectionCount, s.SelectionTypes, s.DocTitle);

        private static string MapSelectType(int t) => (swSelectType_e)t switch
        {
            swSelectType_e.swSelEDGES => "edge",
            swSelectType_e.swSelFACES => "face",
            swSelectType_e.swSelVERTICES => "vertex",
            swSelectType_e.swSelDATUMPLANES => "plane",
            swSelectType_e.swSelSKETCHES => "sketch",
            swSelectType_e.swSelSOLIDBODIES => "body",
            swSelectType_e.swSelCOMPONENTS => "component",
            _ => "other",
        };

        /* ---- Throttle: compute now (STA), emit at most every MinIntervalMs ---- */

        private void Touch()
        {
            ContextState state;
            try { state = Compute(); }
            catch { return; }

            ContextState? toEmit = null;
            lock (_gate)
            {
                if (_stopped || state.SameAs(_lastSent)) return;
                _pending = state;

                long now = _clock.ElapsedMilliseconds;
                long since = now - _lastSendTicks;
                if (since >= MinIntervalMs)
                {
                    toEmit = TakePending(now);
                }
                else if (_flushTimer == null)
                {
                    _flushTimer = new Timer(_ => Flush(), null, MinIntervalMs - since, Timeout.Infinite);
                }
            }
            if (toEmit != null) SafeEmit(toEmit); // never call out while holding _gate
        }

        private void Flush()
        {
            ContextState? toEmit = null;
            lock (_gate)
            {
                _flushTimer?.Dispose();
                _flushTimer = null;
                if (_stopped) return;
                if (_pending != null && !_pending.SameAs(_lastSent))
                    toEmit = TakePending(_clock.ElapsedMilliseconds);
            }
            if (toEmit != null) SafeEmit(toEmit);
        }

        /// <summary>Caller holds _gate. Promotes _pending to "sent" and cancels any armed timer.</summary>
        private ContextState TakePending(long now)
        {
            var state = _pending!;
            _lastSent = state;
            _lastSendTicks = now;
            _pending = null;
            _flushTimer?.Dispose();
            _flushTimer = null;
            return state;
        }

        private void SafeEmit(ContextState state)
        {
            try { _onChanged(state); } catch { }
        }

        public void Dispose() => Stop();
    }
}
