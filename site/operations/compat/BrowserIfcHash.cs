global using MD5 = BrowserIfcHash;

using Org.BouncyCastle.Crypto.Digests;

// IFC export uses this digest for stable IDs, including on browsers without MD5 in the runtime.
internal static class BrowserIfcHash
{
    public static byte[] HashData(byte[] input)
    {
        var digest = new MD5Digest();
        digest.BlockUpdate(input, 0, input.Length);
        var output = new byte[digest.GetDigestSize()];
        digest.DoFinal(output, 0);
        return output;
    }
}
