using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Facet.AddIn
{
    /// <summary>Serializes outbound messages and parses inbound ones. Mirrors shared/protocol.md.</summary>
    internal static class WireProtocol
    {
        public const int Protocol = 1;

        public static string Hello(int port, string addinVersion) =>
            JsonConvert.SerializeObject(new
            {
                v = 1,
                type = "hello",
                app = "SolidWorks",
                appVersion = "2026",
                port,
                protocol = Protocol,
                addinVersion,
            });

        public static string Context(ContextState s) =>
            JsonConvert.SerializeObject(new
            {
                v = 1,
                type = "context",
                docType = s.DocType,
                inSketch = s.InSketch,
                activeCommand = s.ActiveCommand,
                selection = new { count = s.SelectionCount, types = s.SelectionTypes },
                docTitle = s.DocTitle,
                layout = s.Layout,
            });

        public static string Result(string nonce, bool ok, string? message) =>
            JsonConvert.SerializeObject(new { v = 1, type = "result", nonce, ok, message });

        /// <summary>Parse an inbound message; returns null for anything we don't handle.</summary>
        public static InboundMessage? Parse(string json)
        {
            JObject o;
            try { o = JObject.Parse(json); }
            catch { return null; }

            switch ((string?)o["type"])
            {
                case "ready":
                    return new InboundMessage
                    {
                        Type = InboundType.Ready,
                        Device = (string?)o["device"] ?? "",
                        PluginVersion = (string?)o["pluginVersion"] ?? "",
                    };
                case "invoke":
                    return new InboundMessage
                    {
                        Type = InboundType.Invoke,
                        Nonce = (string?)o["nonce"] ?? "",
                        Command = (string?)o["command"],
                        CommandId = (int?)o["commandId"],
                        Slot = (int?)o["slot"] ?? -1,
                        Layout = (string?)o["layout"] ?? "",
                    };
                default:
                    return null;
            }
        }
    }

    internal enum InboundType { Ready, Invoke }

    internal sealed class InboundMessage
    {
        public InboundType Type { get; set; }
        public string Nonce { get; set; } = "";
        public string? Command { get; set; }
        public int? CommandId { get; set; }
        public int Slot { get; set; }
        public string Layout { get; set; } = "";
        public string Device { get; set; } = "";
        public string PluginVersion { get; set; } = "";
    }
}
