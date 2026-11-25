using System.Globalization;
using System.Reflection;
using System.Runtime.InteropServices.JavaScript;
using System.Runtime.Versioning;
using System.Text;
using System.Text.Json;
#if !MODEL_EXPORT
using OpenMcdf;
#endif
#if MODEL_EXPORT
using IOScene;
using IOScene.Formats;
using IOViewer.Exporters;
using NwcIO.Scene;
using RvtIO.Scene;
using RvtIO;
#endif

[SupportedOSPlatform("browser")]
internal static partial class Runner
{
    private static void Main() { }

#if !MODEL_EXPORT
    [JSExport]
    internal static int ReadRevitVersion(string path)
    {
        using var root = RootStorage.OpenRead(path);
        if (!root.TryOpenStream("BasicFileInfo", out var stream))
            throw new InvalidDataException("В контейнере отсутствуют метаданные Revit.");
        using (stream)
        {
            if (stream.Length is < 12 or > 256 * 1024)
                throw new InvalidDataException("Некорректный размер метаданных Revit.");
            var bytes = new byte[stream.Length];
            stream.ReadExactly(bytes);
            var reader = typeof(RvtIO.RvtFileReader).Assembly.GetType("RvtIO.Parsing.BasicFileInfoReader", throwOnError: true)!;
            var parse = reader.GetMethod("Parse", BindingFlags.Static | BindingFlags.NonPublic)!;
            var info = (Dictionary<string, string>)parse.Invoke(null, [bytes])!;
            return int.TryParse(info.GetValueOrDefault("RevitVersion"), out int year) && year is >= 2008 and <= 2099
                ? year
                : throw new InvalidDataException("По метаданным не удалось определить версию Revit.");
        }
    }
#endif

    [JSExport]
    internal static string Run(string tool, string arguments)
    {
        string[] args = JsonSerializer.Deserialize<string[]>(arguments) ?? throw new ArgumentException("Не заданы аргументы.");
#if MODEL_EXPORT
        if (tool is "RevitScene" or "NwcScene")
        {
            try { return ExportScene(tool, args); }
            catch (Exception error) { return Failure(error, "", ""); }
        }
#endif
        if (tool is not ("RvtIO.Cli" or "RvtIO.Nwc" or "NwcIO.Cli"))
            throw new ArgumentException("Неизвестный обработчик.", nameof(tool));
        Assembly assembly = Assembly.Load(tool);
        using var output = new TailWriter(args is ["downgrade", ..] ? ReportDowngradeLine : null);
        using var errors = new TailWriter(tool == "RvtIO.Cli" && args is not ["downgrade", ..]
            ? ReportExportLine : null);
        TextWriter originalOutput = Console.Out;
        TextWriter originalErrors = Console.Error;
        try
        {
            Console.SetOut(output);
            Console.SetError(errors);
            int exitCode;
            if (tool == "NwcIO.Cli" && Array.IndexOf(args, "-") >= 0)
            {
                var run = assembly.EntryPoint!.DeclaringType!.GetMethod("Run", BindingFlags.Static | BindingFlags.NonPublic);
                exitCode = (int)run!.Invoke(null, [args, Stream.Null, output, errors])!;
            }
            else
            {
                var entryPoint = assembly.EntryPoint ?? throw new InvalidOperationException("Не найден обработчик.");
                exitCode = (int)entryPoint.Invoke(null, [args])!;
            }
            return JsonSerializer.Serialize(new { exitCode, output = output.ToString(), diagnostics = errors.ToString() });
        }
        catch (Exception error)
        {
            if (error is TargetInvocationException { InnerException: { } cause }) error = cause;
            return Failure(error, output.ToString(), errors.ToString());
        }
        finally
        {
            Console.SetOut(originalOutput);
            Console.SetError(originalErrors);
        }
    }

    private static string Failure(Exception error, string output, string diagnostics) =>
        JsonSerializer.Serialize(new { exitCode = 1, output, diagnostics, error = error.GetBaseException().Message });

    private static void ReportExportLine(string? line)
    {
        // RvtIO.Cli reports this timing after the reader has returned.
        if (line?.StartsWith("Timing: read ", StringComparison.Ordinal) == true)
            ReportProgress("encode", 0, 0);
    }

    private static void ReportDowngradeLine(string? line)
    {
        // The CLI writes this line after planning and before it calls DowngradeWriter.
        if (line?.StartsWith("Classes in both: ", StringComparison.Ordinal) == true)
            ReportProgress("rewrite", 0, 0);
        else if (line?.StartsWith("Downgraded: ", StringComparison.Ordinal) == true)
            ReportProgress("report", 0, 0);
    }

    [JSImport("reportProgress", "operation")]
    private static partial void ReportProgress(string phase,
        [JSMarshalAs<JSType.Number>] long completed, [JSMarshalAs<JSType.Number>] long total);

#if MODEL_EXPORT
    private static string ExportScene(string tool, string[] args)
    {
        if (args is not [var input, var output]) throw new ArgumentException("Не заданы пути к файлам.");
        if (tool == "NwcScene")
        {
            var nwc = NwcSceneReader.Read(input);
            return WriteScene(nwc.Document, nwc.Diagnostics, output);
        }
        var result = RvtSceneReader.Read(input, new RvtSceneOptions
        {
            ReadProgress = new InlineProgress<RvtReadProgress>(update =>
            {
                if (update.GeometryBlocks is { } blocks)
                    ReportProgress("geometry-blocks", blocks.Completed, blocks.Total);
                else
                    ReportProgress(update.Phase, update.Completed, update.Total);
            }),
            MeshProgress = new InlineProgress<(int Completed, int Total)>(update =>
                ReportProgress("meshes", update.Completed, update.Total)),
        });
        return WriteScene(result.Document, result.Diagnostics, output);
    }

    private static string WriteScene(SceneDocument document, IReadOnlyList<SceneDiagnostic> warnings, string output)
    {
        var error = warnings.FirstOrDefault(item => item.Severity == SceneSeverity.Error);
        if (error is not null) throw new InvalidDataException(error.Message);
        if (document.Instances.Count == 0) throw new InvalidDataException("The model has no geometry to export.");
        ReportProgress("encode", 0, 0);
        using var stream = File.Create(output);
        switch (Path.GetExtension(output))
        {
            case ".glb":
                GlbSceneWriter.Write(document, stream);
                break;
            case ".obj":
                using (var writer = new StreamWriter(stream)) ObjSceneWriter.Write(document, writer);
                break;
            case ".html":
                HtmlViewerExporter.Export(document, stream);
                break;
            default:
                throw new ArgumentException("Неизвестный формат экспорта.");
        }
        var diagnostics = string.Join("\n", warnings.Take(30).Select(item => item.Message));
        return JsonSerializer.Serialize(new { exitCode = 0, diagnostics, output = "" });
    }

    private sealed class InlineProgress<T>(Action<T> report) : IProgress<T>
    {
        public void Report(T value) => report(value);
    }
#endif

    private sealed class TailWriter(Action<string?>? onLine = null) : StringWriter(CultureInfo.InvariantCulture)
    {
        private const int Limit = 16_384;

        public override void WriteLine(string? value)
        {
            Write(value);
            Write(NewLine);
            onLine?.Invoke(value);
        }

        public override void Write(char value)
        {
            base.Write(value);
            Trim();
        }

        public override void Write(string? value)
        {
            base.Write(value is { Length: > Limit } ? value[^Limit..] : value);
            Trim();
        }

        public override void Write(ReadOnlySpan<char> value)
        {
            base.Write(value.Length > Limit ? value[^Limit..] : value);
            Trim();
        }

        private void Trim()
        {
            StringBuilder text = GetStringBuilder();
            if (text.Length > Limit * 2) text.Remove(0, text.Length - Limit);
        }
    }
}
