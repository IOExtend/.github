using System.Diagnostics;
using System.Text.Json;
using IOScene;
using IOViewer.Exporters;
using RvtIO.Scene;

if (args.Length != 2)
{
    Console.Error.WriteLine("Usage: NativeHtmlExport <input.rvt> <new-output.html>");
    return 2;
}
if (File.Exists(args[1]))
{
    Console.Error.WriteLine($"Output already exists: {args[1]}");
    return 1;
}

var elapsed = Stopwatch.StartNew();
var result = RvtSceneReader.Read(args[0]);
var readMs = elapsed.ElapsedMilliseconds;
var errors = result.Diagnostics.Where(d => d.Severity == SceneSeverity.Error).ToArray();
if (errors.Length > 0)
{
    foreach (var error in errors)
        Console.Error.WriteLine(error);
    return 1;
}

var output = new FileStream(args[1], FileMode.CreateNew, FileAccess.Write, FileShare.None);
try
{
    using (output)
        HtmlViewerExporter.Export(result.Document, output);
}
catch
{
    File.Delete(args[1]);
    throw;
}

var exportMs = elapsed.ElapsedMilliseconds;
Console.WriteLine(JsonSerializer.Serialize(new
{
    readMs, exportMs, elements = result.Document.Elements.Count,
    instances = result.Document.Instances.Count, geometries = result.Document.Geometries.Count,
}));
return 0;
