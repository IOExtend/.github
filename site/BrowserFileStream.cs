using System.Runtime.InteropServices.JavaScript;
using System.Runtime.Versioning;

[SupportedOSPlatform("browser")]
internal sealed partial class BrowserFileStream(long length) : Stream
{
    private long position;

    public override bool CanRead => true;
    public override bool CanSeek => true;
    public override bool CanWrite => false;
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

    public override int Read(byte[] buffer, int offset, int count)
    {
        ValidateBufferArguments(buffer, offset, count);
        return Read(buffer.AsSpan(offset, count));
    }

    public override int Read(Span<byte> buffer)
    {
        if (position >= length || buffer.IsEmpty) return 0;
        int count = (int)Math.Min(buffer.Length, length - position);
        ReadRange(position, buffer[..count]);
        position += count;
        return count;
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
        Position = checked(start + offset);
        return position;
    }

    public override void Flush() { }
    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

    [JSImport("readRange", "viewer")]
    private static partial void ReadRange(
        [JSMarshalAs<JSType.Number>] long offset,
        [JSMarshalAs<JSType.MemoryView>] Span<byte> destination);
}
