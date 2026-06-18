using System;
using System.Windows.Forms;

namespace Facet.AddIn
{
    /// <summary>
    /// Marshals work onto the SolidWorks main (STA) thread. All SolidWorks COM calls must run there;
    /// key presses arrive on a background WebSocket thread, so they hop back through here.
    ///
    /// Implemented with a hidden <see cref="Control"/> whose handle is created on the SolidWorks UI
    /// thread (which has a message pump), giving us a reliable <c>Invoke</c> target.
    /// </summary>
    internal sealed class MainThreadDispatcher : IDisposable
    {
        private readonly Control _marshal;

        /// <summary>Must be constructed on the SolidWorks main thread (i.e. inside ConnectToSW).</summary>
        public MainThreadDispatcher()
        {
            _marshal = new Control();
            _ = _marshal.Handle; // force handle creation now, on this thread
        }

        public T Invoke<T>(Func<T> func)
        {
            // During shutdown the marshaling control may already be disposed; fail soft.
            if (_marshal.IsDisposed || !_marshal.IsHandleCreated) return default!;
            try
            {
                if (!_marshal.InvokeRequired) return func();
                return (T)_marshal.Invoke(func);
            }
            catch (ObjectDisposedException) { return default!; }
            catch (InvalidOperationException) { return default!; } // handle destroyed mid-call
        }

        public void Invoke(Action action)
        {
            if (_marshal.IsDisposed || !_marshal.IsHandleCreated) return;
            try
            {
                if (!_marshal.InvokeRequired) { action(); return; }
                _marshal.Invoke(action);
            }
            catch (ObjectDisposedException) { }
            catch (InvalidOperationException) { }
        }

        /// <summary>
        /// Fire-and-forget marshal onto the SolidWorks thread (non-blocking). Use this for actions
        /// like RunCommand that may not return until the user dismisses a PropertyManager page —
        /// blocking the caller on those would stall the WebSocket pump.
        /// </summary>
        /// <summary>Returns false if the work could not be dispatched (e.g. during shutdown).</summary>
        public bool Post(Action action)
        {
            if (_marshal.IsDisposed || !_marshal.IsHandleCreated) return false;
            try
            {
                _marshal.BeginInvoke(action);
                return true;
            }
            catch (ObjectDisposedException) { return false; }
            catch (InvalidOperationException) { return false; }
        }

        public void Dispose()
        {
            if (_marshal.IsHandleCreated && !_marshal.IsDisposed)
            {
                try { _marshal.Invoke(new Action(() => _marshal.Dispose())); }
                catch { /* shutting down */ }
            }
        }
    }
}
