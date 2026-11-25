using System.Runtime.InteropServices.JavaScript;
using System.Runtime.Versioning;

[SupportedOSPlatform("browser")]
internal sealed partial class BrowserScratchStream(bool triangles = false) : Stream
{
    public override bool CanRead => true;
    public override bool CanSeek => true;
    public override bool CanWrite => true;
    public override long Length => length;
    public override long Position
    {
        get => position;
        set
        {
            ArgumentOutOfRangeException.ThrowIfNegative(value);
            position = value;
        }
    }

    private long length;
    private long position;

    public override int Read(byte[] buffer, int offset, int count)
    {
        ValidateBufferArguments(buffer, offset, count);
        return Read(buffer.AsSpan(offset, count));
    }

    public override unsafe int Read(Span<byte> buffer)
    {
        int count = (int)Math.Min(buffer.Length, Math.Max(0, length - position));
        if (count == 0) return 0;
        fixed (byte* pointer = buffer)
        {
            int read = Transfer(position, (int)pointer, count, writing: false);
            position += read;
            return read;
        }
    }

    public override void Write(byte[] buffer, int offset, int count)
    {
        ValidateBufferArguments(buffer, offset, count);
        Write(buffer.AsSpan(offset, count));
    }

    public override unsafe void Write(ReadOnlySpan<byte> buffer)
    {
        if (buffer.IsEmpty) return;
        fixed (byte* pointer = buffer)
        {
            int written = Transfer(position, (int)pointer, buffer.Length, writing: true);
            if (written != buffer.Length) throw new IOException("Не удалось записать временные данные модели.");
            position += written;
            length = Math.Max(length, position);
        }
    }

    public override long Seek(long offset, SeekOrigin origin)
    {
        long start = origin switch
        {
            SeekOrigin.Begin => 0,
            SeekOrigin.Current => position,
            SeekOrigin.End => length,
            _ => throw new ArgumentOutOfRangeException(nameof(origin)),
        };
        return Position = checked(start + offset);
    }

    public override void Flush() { }
    public override void SetLength(long value) => throw new NotSupportedException();

    private int Transfer(long offset, int address, int count, bool writing) => triangles
        ? TransferTriangles(offset, address, count, writing)
        : TransferPartitions(offset, address, count, writing);

    [JSImport("scratchTransfer", "viewer")]
    private static partial int TransferPartitions([JSMarshalAs<JSType.Number>] long offset, int address, int count, bool writing);

    [JSImport("triangleTransfer", "viewer")]
    private static partial int TransferTriangles([JSMarshalAs<JSType.Number>] long offset, int address, int count, bool writing);
}
