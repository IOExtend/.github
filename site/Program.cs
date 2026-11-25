using System.Runtime.InteropServices.JavaScript;
using System.Runtime.Versioning;
using IOScene;
using IOViewer.Exporters;
#if LOCAL_MESH_PAGES
using IOViewer.Model;
#endif
using NwcIO;
using NwcIO.Model;
using NwcIO.Scene;
using RvtIO;
using RvtIO.Scene;

[SupportedOSPlatform("browser")]
internal static partial class Program
{
    private static void Main() { }

#if BROWSER_THREADS
    [JSExport]
    internal static Task OpenModel(string name, [JSMarshalAs<JSType.Number>] long length, bool useScratch) =>
        OpenForWorker(name, length, useScratch, usePages: false);

#if LOCAL_MESH_PAGES
    [JSExport]
    internal static Task OpenPagedModel(string name, [JSMarshalAs<JSType.Number>] long length) =>
        OpenForWorker(name, length, useScratch: true, usePages: true);
#endif

    private static Task OpenForWorker(string name, long length, bool useScratch, bool usePages)
    {
        try
        {
            var html = OpenModelCore(name, length, useScratch, usePages);
            if (html.Length > 0) ReportHtml(html);
        }
        catch (Exception error)
        {
            // Exceptions thrown before returning a task do not reach the threaded JS caller.
            ReportFailure(error is OutOfMemoryException ? nameof(OutOfMemoryException) : error.Message,
                error is AggregateException);
        }
        return Task.CompletedTask;
    }
#else
    [JSExport]
    internal static byte[] OpenModel(string name, [JSMarshalAs<JSType.Number>] long length, bool useScratch) =>
        OpenModelCore(name, length, useScratch, usePages: false);

#if LOCAL_MESH_PAGES
    [JSExport]
    internal static byte[] OpenPagedModel(string name, [JSMarshalAs<JSType.Number>] long length) =>
        OpenModelCore(name, length, useScratch: true, usePages: true);
#endif
#endif

    private static byte[] OpenModelCore(string name, long length, bool useScratch, bool usePages)
    {
        if (length <= 0)
            throw new InvalidDataException("emptyFile");

        string extension = Path.GetExtension(name).ToLowerInvariant();
        if (extension is not (".rvt" or ".nwc"))
            throw new InvalidDataException("chooseRvtNwc");

        using var stream = new BrowserFileStream(length);
        using var triangleScratch = extension == ".rvt" && useScratch
            ? new BufferedStream(new BrowserScratchStream(triangles: true), 64 * 1024) : null;
        (SceneDocument scene, IReadOnlyList<SceneDiagnostic> diagnostics) = extension == ".rvt"
            ? ReadRvt(stream, name, triangleScratch)
            : ReadNwc(stream, name);

        if (scene.Instances.Count == 0)
            throw new InvalidDataException("view.noGeometry");

        ReportDiagnostics(
            diagnostics.Count(d => d.Severity == SceneSeverity.Warning),
            diagnostics.Count(d => d.Severity == SceneSeverity.Error));
        ReportScene(scene.Elements.Count, scene.Instances.Count, scene.Geometries.Count);

#if LOCAL_MESH_PAGES
        if (usePages && scene.Geometries.All(geometry => geometry.Topology == SceneTopology.Triangles))
        {
            using var cluster = new BufferedStream(new BrowserScratchStream(), 64 * 1024);
            ReportCluster(ClusterSourceWriter.Export(new ViewerDocument(scene), cluster));
            return [];
        }
#endif

        using var html = new MemoryStream();
        HtmlViewerExporter.Export(scene, html);
        return html.ToArray();
    }

#if BROWSER_THREADS
    [JSImport("reportHtml", "viewer")]
    private static partial void ReportHtml(byte[] html);

    [JSImport("reportFailure", "viewer")]
    private static partial void ReportFailure(string detail, bool parallelFailure);
#endif

    [JSImport("reportScene", "viewer")]
    private static partial void ReportScene(int elements, int instances, int geometries);

    [JSImport("resetPartitionScratch", "viewer")]
    private static partial void ResetPartitionScratch();

#if LOCAL_MESH_PAGES
    [JSImport("reportCluster", "viewer")]
    private static partial void ReportCluster([JSMarshalAs<JSType.Number>] long triangles);
#endif

    private static (SceneDocument, IReadOnlyList<SceneDiagnostic>) ReadRvt(Stream stream, string name, Stream? triangleScratch)
    {
#if RVT_PARTITION_SCRATCH
        bool releasePartitions = triangleScratch != null;
#endif
        var options = new RvtSceneOptions
        {
            ModelKey = name,
            ReadProgress = new InlineProgress<RvtReadProgress>(ReportRvtProgress),
#if RVT_PARTITION_SCRATCH
            MeshProgress = new InlineProgress<(int Completed, int Total)>(update =>
            {
                // The reader has disposed its partition stream before mesh extraction starts.
                if (releasePartitions)
                {
                    ResetPartitionScratch();
                    releasePartitions = false;
                }
                ReportRvtMeshProgress(update);
            }),
            CreatePartitionScratch = triangleScratch == null ? null : () => new BufferedStream(new BrowserScratchStream(), 64 * 1024),
#endif
        };
#if RVT_PARTITION_SCRATCH
        var result = triangleScratch == null
            ? RvtSceneReader.ReadStream(stream, options)
            : RvtSceneReader.ReadStream(stream, options, triangleScratch);
#else
        var result = RvtSceneReader.ReadStream(stream, options);
#endif
        return (result.Document, result.Diagnostics);
    }

    private static void ReportRvtMeshProgress((int Completed, int Total) update)
    {
        if (update.Total == 0) return;
        int percent = 92 + (int)(3L * update.Completed / update.Total);
        ReportProgress(percent, "view.rvtScene", update.Completed, update.Total);
    }

    private static (SceneDocument, IReadOnlyList<SceneDiagnostic>) ReadNwc(Stream stream, string name)
    {
        ReportProgress(8, "view.nwcContainer");
        var document = NwcDocument.Open(stream, null, Path.GetFileNameWithoutExtension(name),
            new InlineProgress<NwcProgress>(ReportNwcProgress), default);
        var result = NwcSceneReader.Read(document, new NwcSceneOptions { ModelKey = name });
        return (result.Document, result.Diagnostics);
    }

    private static void ReportRvtProgress(RvtReadProgress update)
    {
#if POOLED_BROWSER_GC
        if (update.Completed == 0 && update.Phase is "build-model" or "finalize-model")
        {
            GC.Collect(GC.MaxGeneration, GCCollectionMode.Forced, blocking: true, compacting: true);
            UpdateGcProfile(update.Phase, update.Total);
        }
#endif
        // Stage ranges approximate overall work. Only the counters within a stage are measured.
        switch (update.Phase)
        {
            case "metadata": ReportProgress(8, "view.metadata"); break;
            case "partitions":
                ReportProgress(Within(10, 19, update), "view.partitions", update.Completed, update.Total);
                break;
            case "class-schema": ReportProgress(20, "phase.class-schema"); break;
            case "element-records":
                ReportProgress(Within(25, 30, update), update.Total == 0 ? "phase.element-records" : "view.records",
                    update.Completed, update.Total);
                break;
            case "element-blocks":
#if RVT_PARTITION_SCRATCH
                if (update.GeometryBlocks is { } geometry)
                {
                    double pass = update.Completed + geometry.Completed / (double)geometry.Total;
                    int percent = 31 + (int)(15 * pass / update.Total);
                    ReportProgress(percent, "view.geometry", geometry.Completed, geometry.Total);
                }
                else
#endif
                    ReportProgress(Within(31, 46, update), "view.blocks", update.Completed, update.Total);
                break;
            case "parameter-stream":
                ReportProgress(Within(47, 63, update), update.Total > 0 ? "view.paramCount" : "phase.parameter-stream",
                    ToMiB(update.Completed), ToMiB(update.Total));
                break;
            case "recover-geometry":
#if RVT_PARTITION_SCRATCH
                if (update.GeometryBlocks is { } recovered)
                {
                    var (percent, stage) = update.Completed switch
                    {
                        2 => (66, "view.decodeFound"),
                        3 => (67, "view.wallGeometry"),
                        _ => (64, "view.decodeGeometry"),
                    };
                    if (recovered.Completed == recovered.Total) percent++;
                    ReportProgress(percent, stage, recovered.Completed, recovered.Total);
                }
                else
#endif
                {
                    switch (update.Completed)
                    {
                        case 0: ReportProgress(64, "phase.recover-geometry"); break;
                        case 1: ReportProgress(65, "view.seekGeometry"); break;
                        case 2: ReportProgress(66, "view.decodeFound"); break;
                        case 3: ReportProgress(67, "view.wallGeometry"); break;
                    }
                }
                break;
            case "element-properties":
                ReportProgress(Within(68, 74, update), update.Total == 0 ? "phase.element-properties" : "view.properties",
                    update.Completed, update.Total);
                break;
            case "build-model":
                ReportProgress(Within(75, 87, update), update.Total > 0 ? "view.buildModel" : "phase.build-model",
                    update.Completed, update.Total);
                break;
            case "finalize-model":
                switch (update.Completed)
                {
                    case 0: ReportProgress(88, "view.linkTypes"); break;
                    case 1: ReportProgress(88, "view.modelValues"); break;
                    case 2: ReportProgress(89, "view.derivedProperties"); break;
                    case 3: ReportProgress(89, "view.phasesLevels"); break;
                    case 4: ReportProgress(90, "view.systemNames"); break;
                    case 5: ReportProgress(90, "view.resolveRefs"); break;
                    case 6: ReportProgress(91, "view.unitsCoordinates"); break;
                }
                break;
            case "complete": ReportProgress(92, "view.prepareScene"); break;
        }
    }

#if POOLED_BROWSER_GC
    [JSImport("updateGcProfile", "viewer")]
    private static partial void UpdateGcProfile(string phase, [JSMarshalAs<JSType.Number>] long total);
#endif

    private static double ToMiB(long bytes) => bytes / (1024d * 1024d);

    private static int Within(int start, int end, RvtReadProgress update) => update.Total == 0
        ? start
        : start + (int)((end - start) * (update.Completed / (double)update.Total));

    private static void ReportNwcProgress(NwcProgress update)
    {
        switch (update.Phase)
        {
            case "read-container": ReportProgress(23, "view.nwcGeometry"); break;
            case "read-geometry": ReportProgress(72, "view.nwcProperties"); break;
            case "open": ReportProgress(92, "view.nwcScene"); break;
        }
    }

    private sealed class InlineProgress<T>(Action<T> report) : IProgress<T>
    {
        public void Report(T value) => report(value);
    }

    [JSImport("reportProgress", "viewer")]
    private static partial void ReportProgress(int percent, string key, double completed = 0, double total = 0);

    [JSImport("reportDiagnostics", "viewer")]
    private static partial void ReportDiagnostics(int warnings, int errors);
}
