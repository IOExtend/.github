param(
    [Parameter(Mandatory)] [string] $Site,
    [Parameter(Mandatory)] [string] $Build,
    [Parameter(Mandatory)] [string] $RvtIOProgressSource,
    [Parameter(Mandatory)] [string] $NwcIOSource,
    [Parameter(Mandatory)] [string] $DowngradeSource,
    [switch] $ExportLargeHeap,
    [string] $IOViewerSource
)

$ErrorActionPreference = 'Stop'
$project = Join-Path $PSScriptRoot 'IOExtend.Operations.csproj'
$siteRoot = (Resolve-Path -LiteralPath $Site).Path
if (!(Test-Path -LiteralPath (Join-Path $siteRoot 'index.html'))) {
    throw 'Site must point to the published wwwroot containing index.html.'
}
$Build = [IO.Path]::GetFullPath($Build)

function Publish-Tool([string] $name, [string[]] $properties) {
    $folder = Join-Path $Build $name
    $output = Join-Path $folder 'publish'
    dotnet publish $project -c Release -m:1 -nodeReuse:false --artifacts-path (Join-Path $folder 'artifacts') -o $output @properties
    if ($LASTEXITCODE -ne 0) { throw "Could not build $name." }
    $destination = Join-Path $siteRoot $name
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    Copy-Item -Path (Join-Path $output 'wwwroot/*') -Destination $destination -Recurse -Force
}

Publish-Tool 'model-export' @(
    "-p:RvtIOProgressSource=$((Resolve-Path -LiteralPath $RvtIOProgressSource).Path)"
    "-p:NwcIOSource=$((Resolve-Path -LiteralPath $NwcIOSource).Path)"
    "-p:CustomAfterMicrosoftCommonTargets=$(Join-Path $PSScriptRoot 'compat/BrowserRvt.targets')"
    "-p:IOExtendLargeExportHeap=$($ExportLargeHeap.IsPresent.ToString().ToLowerInvariant())"
    if ($IOViewerSource) { "-p:IOViewerSource=$((Resolve-Path -LiteralPath $IOViewerSource).Path)" }
)
Publish-Tool 'revit-downgrade' @(
    "-p:DowngradeSource=$((Resolve-Path -LiteralPath $DowngradeSource).Path)"
)

node (Join-Path $PSScriptRoot '../prepare-web-release.mjs') $siteRoot
if ($LASTEXITCODE -ne 0) { throw 'Could not prepare the site release.' }
