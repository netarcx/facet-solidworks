using System;
using System.Collections.Concurrent;
using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Facet.AddIn
{
    /// <summary>
    /// The private local WebSocket server the Stream Deck plugin connects to. Lives on background
    /// threads; never touches SolidWorks COM directly. Inbound <c>invoke</c>s are handed to
    /// <see cref="OnInvoke"/> (which marshals onto the SolidWorks thread); everything else is I/O.
    ///
    /// Binds to <c>http://localhost:port/</c> — the one prefix HttpListener accepts WITHOUT admin
    /// rights or a netsh URL reservation (a specific IP like 127.0.0.1 would require one). The
    /// plugin connects to <c>ws://localhost:port</c> to match.
    /// </summary>
    internal sealed class WsServer : IDisposable
    {
        private const int PrimaryPort = 8723;
        private const int PortRange = 11; // 8723..8733

        private readonly ConcurrentDictionary<Guid, ClientConn> _clients = new ConcurrentDictionary<Guid, ClientConn>();
        private readonly CancellationTokenSource _cts = new CancellationTokenSource();
        private HttpListener? _listener;
        private string _addinVersion = "0.0.0";
        private volatile string? _latestContext;

        public int Port { get; private set; }

        /// <summary>Runs a command for an inbound invoke and reports success. Set by the add-in.</summary>
        public Func<InboundMessage, bool>? OnInvoke { get; set; }

        /// <summary>Optional log sink (so the add-in can route to a file / debug output).</summary>
        public Action<string>? Log { get; set; }

        public void Start(string addinVersion)
        {
            _addinVersion = addinVersion;
            _listener = BindAnyPort();
            if (_listener == null)
            {
                Log?.Invoke($"Facet: could not bind any port in {PrimaryPort}..{PrimaryPort + PortRange - 1}.");
                return;
            }
            Log?.Invoke($"Facet: WebSocket server listening on ws://localhost:{Port}");
            _ = Task.Run(AcceptLoopAsync);
        }

        private HttpListener? BindAnyPort()
        {
            for (int i = 0; i < PortRange; i++)
            {
                int port = PrimaryPort + i;
                var listener = new HttpListener();
                listener.Prefixes.Add($"http://localhost:{port}/");
                try
                {
                    listener.Start();
                    Port = port;
                    return listener;
                }
                catch (HttpListenerException)
                {
                    // Port busy — try the next one.
                    try { listener.Close(); } catch { }
                }
            }
            return null;
        }

        /// <summary>Push a fresh context to every connected client and cache it for newcomers.</summary>
        public void BroadcastContext(string contextJson)
        {
            _latestContext = contextJson;
            foreach (var c in _clients.Values) c.Enqueue(contextJson);
        }

        private async Task AcceptLoopAsync()
        {
            while (!_cts.IsCancellationRequested && _listener != null)
            {
                HttpListenerContext ctx;
                try { ctx = await _listener.GetContextAsync().ConfigureAwait(false); }
                catch { break; } // listener stopped

                if (!ctx.Request.IsWebSocketRequest)
                {
                    ctx.Response.StatusCode = 400;
                    try { ctx.Response.Close(); } catch { }
                    continue;
                }

                _ = HandleClientAsync(ctx);
            }
        }

        private async Task HandleClientAsync(HttpListenerContext ctx)
        {
            WebSocketContext wsCtx;
            try { wsCtx = await ctx.AcceptWebSocketAsync(null).ConfigureAwait(false); }
            catch { return; }

            var connCts = CancellationTokenSource.CreateLinkedTokenSource(_cts.Token);
            var conn = new ClientConn(wsCtx.WebSocket, connCts.Token);
            _clients[conn.Id] = conn;
            Log?.Invoke($"Facet: plugin connected ({_clients.Count} total)");

            Task send = Task.CompletedTask, recv = Task.CompletedTask;
            try
            {
                // Greet, then send the latest context (or an empty one) so the deck paints at once,
                // even if SolidWorks hasn't changed state since startup.
                conn.Enqueue(WireProtocol.Hello(Port, _addinVersion));
                conn.Enqueue(_latestContext ?? WireProtocol.Context(ContextState.Empty));

                send = conn.SendPumpAsync();
                recv = ReceivePumpAsync(conn);

                await Task.WhenAny(send, recv).ConfigureAwait(false);
            }
            catch { /* fall through to cleanup */ }
            finally
            {
                // Tear down deterministically: cancel, let both pumps unwind, then dispose once.
                try { connCts.Cancel(); } catch { }
                conn.CompleteSend();
                try { await Task.WhenAll(Quiet(send), Quiet(recv)).ConfigureAwait(false); } catch { }

                _clients.TryRemove(conn.Id, out _);
                conn.Dispose();
                connCts.Dispose();
                Log?.Invoke($"Facet: plugin disconnected ({_clients.Count} total)");
            }
        }

        private static async Task Quiet(Task t)
        {
            try { await t.ConfigureAwait(false); } catch { }
        }

        private async Task ReceivePumpAsync(ClientConn conn)
        {
            var buffer = new byte[8192];
            var sb = new StringBuilder();
            while (!conn.Token.IsCancellationRequested && conn.Socket.State == WebSocketState.Open)
            {
                WebSocketReceiveResult result;
                try { result = await conn.Socket.ReceiveAsync(new ArraySegment<byte>(buffer), conn.Token).ConfigureAwait(false); }
                catch { break; }

                if (result.MessageType == WebSocketMessageType.Close) break;
                sb.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));
                if (!result.EndOfMessage) continue;

                var json = sb.ToString();
                sb.Clear();
                HandleInbound(conn, json);
            }
        }

        private void HandleInbound(ClientConn conn, string json)
        {
            InboundMessage? msg;
            try { msg = WireProtocol.Parse(json); }
            catch { return; } // malformed message must never kill the pump
            if (msg == null) return;

            if (msg.Type == InboundType.Ready)
            {
                Log?.Invoke($"Facet: plugin ready (device={msg.Device}, v{msg.PluginVersion})");
                return;
            }

            // Invoke: run the command on the SolidWorks thread, then reply with the result.
            bool ok = false;
            string? error = null;
            try { ok = OnInvoke?.Invoke(msg) ?? false; }
            catch (Exception ex) { error = ex.Message; }
            conn.Enqueue(WireProtocol.Result(msg.Nonce, ok, ok ? null : error ?? "Command did not run"));
        }

        public void Stop()
        {
            try { _cts.Cancel(); } catch { }
            foreach (var c in _clients.Values) c.Dispose();
            _clients.Clear();
            try { _listener?.Stop(); } catch { }
            try { _listener?.Close(); } catch { }
        }

        public void Dispose()
        {
            Stop();
            _cts.Dispose();
        }

        /// <summary>One connected plugin. Serializes sends through an internal queue; idempotent dispose.</summary>
        private sealed class ClientConn : IDisposable
        {
            private readonly BlockingCollection<string> _outbox = new BlockingCollection<string>(new ConcurrentQueue<string>());
            private int _disposed;

            public Guid Id { get; } = Guid.NewGuid();
            public WebSocket Socket { get; }
            public CancellationToken Token { get; }

            public ClientConn(WebSocket socket, CancellationToken token)
            {
                Socket = socket;
                Token = token;
            }

            public void Enqueue(string json)
            {
                // Racing against CompleteAdding/Dispose is expected; swallow the resulting throw.
                try { if (!_outbox.IsAddingCompleted) _outbox.Add(json); }
                catch (InvalidOperationException) { }
                catch (ObjectDisposedException) { }
            }

            /// <summary>Stop accepting new sends and let the send pump drain to completion.</summary>
            public void CompleteSend()
            {
                try { _outbox.CompleteAdding(); } catch { }
            }

            public async Task SendPumpAsync()
            {
                try
                {
                    foreach (var json in _outbox.GetConsumingEnumerable(Token))
                    {
                        if (Socket.State != WebSocketState.Open) break;
                        var bytes = Encoding.UTF8.GetBytes(json);
                        await Socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, Token).ConfigureAwait(false);
                    }
                }
                catch { /* cancelled or socket closed */ }
            }

            public void Dispose()
            {
                if (Interlocked.Exchange(ref _disposed, 1) != 0) return; // idempotent
                try { _outbox.CompleteAdding(); } catch { }
                // Abort rather than CloseAsync: teardown must never block on a peer handshake.
                try { Socket.Abort(); } catch { }
                try { Socket.Dispose(); } catch { }
                try { _outbox.Dispose(); } catch { }
            }
        }
    }
}
