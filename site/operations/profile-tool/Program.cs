using System.Reflection;
using System.Text;
using OpenMcdf;

if (args.Length < 3 || args.Length % 2 != 1)
    throw new ArgumentException("Usage: BuildProfiles <directory> <release> <profile.rvt> [...]");

Directory.CreateDirectory(args[0]);
var assembly = typeof(RvtIO.RvtFileReader).Assembly;
var reader = assembly.GetType("RvtIO.Parsing.BasicFileInfoReader", throwOnError: true)!;
var read = reader.GetMethod("Read", BindingFlags.Public | BindingFlags.Static)!;
var planner = assembly.GetType("RvtIO.Writing.DowngradePlanner", throwOnError: true)!;
var plan = planner.GetMethod("Plan", BindingFlags.NonPublic | BindingFlags.Static)!;
var rule = Enum.Parse(plan.GetParameters()[2].ParameterType, "Exact");

for (int i = 1; i < args.Length; i += 2)
{
    int year = int.Parse(args[i]);
    if (year is < 2020 or > 2026) throw new ArgumentException($"Unsupported profile year {year}.");
    using var source = RootStorage.OpenRead(args[i + 1]);
    var info = (Dictionary<string, string>)read.Invoke(null, [source])!;
    if (info.GetValueOrDefault("RevitVersion") != args[i])
        throw new InvalidDataException($"Input metadata must match Revit {year}.");
    if (!info.TryGetValue("Build", out string? build) || string.IsNullOrWhiteSpace(build))
        throw new InvalidDataException($"Input metadata must contain the Revit {year} build.");

    string output = Path.Combine(args[0], $"{year}.rvt");
    string temporary = output + ".tmp";
    try
    {
        using (var profile = RootStorage.Create(temporary, OpenMcdf.Version.V3))
        {
            using (var metadata = profile.CreateStream("BasicFileInfo"))
            using (var writer = new BinaryWriter(metadata))
            {
                writer.Write(int.Parse(info["StreamVersion"]));
                foreach (string value in new[] { args[i], build })
                {
                    writer.Write(value.Length);
                    writer.Write(Encoding.Unicode.GetBytes(value));
                }
            }
            using (var contents = source.OpenStream("Contents"))
            using (var target = profile.CreateStream("Contents"))
                contents.CopyTo(target);
            using (var schema = source.OpenStorage("Formats").OpenStream("Latest"))
            using (var target = profile.CreateStorage("Formats").CreateStream("Latest"))
                schema.CopyTo(target);
        }
        // The planner treats this as a source and checks its saved year against the class table.
        // Its expected same-year refusal proves the reduced profile passed both container reads.
        try
        {
            plan.Invoke(null, [temporary, args[i + 1], rule, false]);
            throw new InvalidDataException($"The Revit {year} profile was not validated.");
        }
        catch (TargetInvocationException error) when (
            error.InnerException?.GetType().GetProperty("Kind", BindingFlags.Instance | BindingFlags.NonPublic)
                ?.GetValue(error.InnerException) as string == "profile-not-older")
        {
            File.Move(temporary, output, overwrite: true);
        }
        Console.WriteLine($"Revit {year}: {new FileInfo(output).Length:N0} bytes");
    }
    finally
    {
        if (File.Exists(temporary)) File.Delete(temporary);
    }
}
