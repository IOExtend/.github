#if PARALLEL_RVT_READER
using System.Runtime.InteropServices.JavaScript;
using RvtIO;

internal static partial class Program
{
    [JSExport]
    internal static void EnableBrowserPartitionInflate() => RvtFileReader.BrowserInflatePartitionMembers = InflatePartitionMembers;

    [JSImport("inflatePartitionMembers", "viewer")]
    private static partial byte[] InflatePartitionMembers(byte[] input);

    [JSExport]
    internal static void SetNameScanner()
    {
        RvtFileReader.BrowserBeginNameScan = BeginNameScan;
        RvtFileReader.BrowserSendNameChunk = SendNameChunk;
        RvtFileReader.BrowserSealNameScan = SealNameScan;
        RvtFileReader.BrowserCollectNameScan = CollectNameScan;
    }

    [JSImport("beginNameScan", "viewer")]
    private static partial bool BeginNameScan(byte[] ids, string culture);

    [JSImport("sendNameChunk", "viewer")]
    private static partial void SendNameChunk(int index, byte[] bytes);

    [JSImport("sealNameScan", "viewer")]
    private static partial void SealNameScan();

    [JSImport("collectNameScan", "viewer")]
    private static partial byte[] CollectNameScan();

    [JSExport]
    internal static void StartWorkerNames(byte[] ids, string culture) => RvtFileReader.BeginBrowserNameScan(ids, culture);

    [JSExport]
    internal static void ScanWorkerNames(int index, byte[] bytes) => RvtFileReader.ScanBrowserNameChunk(index, bytes);

    [JSExport]
    internal static byte[] FinishWorkerNames() => RvtFileReader.FinishBrowserNameScan();

    [JSExport]
    internal static void SetParameterWorkers()
    {
        RvtFileReader.BrowserDecodeParameterBatches = DecodeParameterBatches;
        RvtFileReader.BrowserDecodeGeometryBatches = DecodeGeometryBatches;
        RvtFileReader.BrowserCollectDecoder = CollectDecoderBatch;
        RvtFileReader.BrowserStartInitialGeo = StartDecoderBatch;
        RvtFileReader.BrowserStartDeferredParams = StartDecoderBatch;
        RvtFileReader.BrowserStartGeometryPipeline = StartDecoderBatch;
    }

    [JSImport("startDecoderBatch", "viewer")]
    private static partial void StartDecoderBatch(int channel, byte[] first, byte[] second, byte[] third, byte[] fourth);

    [JSImport("collectDecoderBatch", "viewer")]
    private static partial byte[] CollectDecoderBatch(int channel);

    [JSExport]
    internal static byte[] DecodeGeometryBatch(byte[] input) => RvtFileReader.DecodeBrowserGeometryBatch(input);

    [JSExport]
    internal static void EnableBrowserR22Ranges() => RvtFileReader.BrowserRewriteR22Ranges = RewriteR22Ranges;

    [JSExport]
    internal static void BeginBrowserR22RangeWorker(byte[] schema, int width, bool trackIds) =>
        RvtFileReader.BeginBrowserR22RangeWorker(schema, width, trackIds);

    [JSExport]
    internal static byte[] DecodeBrowserR22Range(byte[] input, byte[] plan) =>
        RvtFileReader.DecodeBrowserR22Range(input, plan);

    [JSExport]
    internal static void EndBrowserR22RangeWorker() => RvtFileReader.EndBrowserR22RangeWorker();

    [JSImport("rewriteR22Ranges", "viewer")]
    private static partial byte[] RewriteR22Ranges(byte[] schema, int width, bool trackIds, byte[] input, byte[] plan);

    [JSImport("decodeGeometryBatches", "viewer")]
    private static partial byte[] DecodeGeometryBatches(byte[] first, byte[] second, byte[] third, byte[] fourth);

    [JSExport]
    internal static byte[] DecodeParameterBatch(byte[] input) => RvtFileReader.DecodeBrowserParameterBatch(input);

    [JSImport("decodeParameterBatches", "viewer")]
    private static partial byte[] DecodeParameterBatches(byte[] first, byte[] second, byte[] third, byte[] fourth);
}
#endif
