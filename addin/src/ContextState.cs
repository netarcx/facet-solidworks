using System;
using System.Linq;

namespace Facet.AddIn
{
    /// <summary>
    /// An immutable snapshot of "where the user is" in SolidWorks. Built on the SolidWorks main
    /// (STA) thread by <see cref="ContextEngine"/>, then handed to the network layer to broadcast.
    /// </summary>
    internal sealed class ContextState
    {
        public string DocType { get; }       // none | part | assembly | drawing
        public bool InSketch { get; }
        public string? ActiveCommand { get; }
        public int SelectionCount { get; }
        public string[] SelectionTypes { get; }
        public string DocTitle { get; }
        public string Layout { get; }         // resolved catalog key the plugin should show

        public ContextState(
            string docType,
            bool inSketch,
            string? activeCommand,
            int selectionCount,
            string[] selectionTypes,
            string docTitle)
        {
            DocType = docType;
            InSketch = inSketch;
            ActiveCommand = activeCommand;
            SelectionCount = selectionCount;
            SelectionTypes = selectionTypes ?? Array.Empty<string>();
            DocTitle = docTitle ?? string.Empty;
            Layout = ResolveLayout();
        }

        public static ContextState Empty { get; } =
            new ContextState("none", false, null, 0, Array.Empty<string>(), string.Empty);

        /// <summary>Layout precedence — must match shared/protocol.md.</summary>
        private string ResolveLayout()
        {
            if (DocType == "none") return "none";
            if (InSketch) return "sketch";
            if (DocType == "part" && HasGeometrySelection()) return "part.selection";
            return DocType; // part | assembly | drawing
        }

        private bool HasGeometrySelection()
        {
            if (SelectionCount <= 0) return false;
            return SelectionTypes.Any(t => t == "edge" || t == "face" || t == "vertex");
        }

        /// <summary>Cheap equality so we can suppress duplicate broadcasts.</summary>
        public bool SameAs(ContextState? other)
        {
            if (other is null) return false;
            return DocType == other.DocType
                && InSketch == other.InSketch
                && ActiveCommand == other.ActiveCommand
                && SelectionCount == other.SelectionCount
                && DocTitle == other.DocTitle
                && Layout == other.Layout
                && SelectionTypes.SequenceEqual(other.SelectionTypes);
        }
    }
}
