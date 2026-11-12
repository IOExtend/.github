<div align="center">

<img src="https://raw.githubusercontent.com/IOExtend/.github/main/profile/banner.png" alt="IOExtend Banner" width="100%" style="max-width: 960px; border-radius: 12px;" />

# IOExtend

**Pure managed .NET libraries and cross-platform CLI tools for BIM and CAD interoperability.**

*Read, inspect, and convert building models and drawings without the authoring software, its API, or native libraries installed.*

---

[![GitHub Organization](https://img.shields.io/badge/GitHub-IOExtend-181717?style=flat-square&logo=github)](https://github.com/IOExtend)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Platform](https://img.shields.io/badge/.NET-8.0%20%7C%2010.0-512BD4?style=flat-square&logo=dotnet)](https://dotnet.microsoft.com/)
[![Clean-Room](https://img.shields.io/badge/Specification-Clean--Room-10B981?style=flat-square)](https://github.com/IOExtend)

</div>

<br/>

## The Ecosystem

IOExtend is a set of independent .NET engines, each reading one family of BIM or CAD formats, plus a neutral scene model and a standalone HTML viewer. Everything is managed code without native libraries, for use in CI/CD pipelines, web backends, and desktop engineering software.

### Engines

| Project | Primary Formats | Key Capabilities | Documentation | NuGet | Release | Brand Palette |
|:---|:---|:---|:---:|:---:|:---:|:---:|
| **[RvtIO](https://github.com/IOExtend/RvtIO)** | `.rvt`, `.rfa` (Revit 2020–2026 tested, 2027 partial) | Elements, parameters, geometry, file metadata and project information, `FilteredElementCollector` queries, IFC2X3 and JSON export. Reads only; does not write Revit files | [![Docs](https://img.shields.io/badge/Docs-Online-F2A33A?style=flat-square&logo=github)](https://ioextend.github.io/RvtIO/) | [![NuGet](https://img.shields.io/nuget/v/RvtIO?style=flat-square&color=F2A33A&logo=nuget)](https://www.nuget.org/packages/RvtIO) | [![Release](https://img.shields.io/github/v/release/IOExtend/RvtIO?style=flat-square&color=F2A33A)](https://github.com/IOExtend/RvtIO/releases) | `Amber` `#F2A33A` |
| **[NwcIO](https://github.com/IOExtend/NwcIO)** | `.nwc`, `.nwd`, `.nwf` (Navisworks 2016–2026 tested) | Scene hierarchy, meshes, materials, GUIDs and properties; viewpoints and redlines; JSON export; writes `.nwc`. *Frozen, bug fixes only:* IFC2X3/IFC4, glTF, OBJ and HTML export, clash detection, grouping and matrix, HTML clash report, BCF 2.1, measure, grids, revision diff, TimeLiner, selection and search sets, appearance profiler, mesh clipper, Navisworks XML | [![Docs](https://img.shields.io/badge/Docs-Online-3B82F6?style=flat-square&logo=github)](https://ioextend.github.io/NwcIO/) | [![NuGet](https://img.shields.io/nuget/v/NwcIO?style=flat-square&color=3B82F6&logo=nuget)](https://www.nuget.org/packages/NwcIO) | [![Release](https://img.shields.io/github/v/release/IOExtend/NwcIO?style=flat-square&color=3B82F6)](https://github.com/IOExtend/NwcIO/releases) | `Azure Blue` `#3B82F6` |
| **[IfcIO](https://github.com/IOExtend/IfcIO)** | `.ifc`, `.ifczip` | Reads and writes ISO 10303-21 STEP for buildingSMART IFC2x3 CV 2.0 and IFC4, spatial hierarchy, properties and meshes, `IfcApi` facade, 5D cost schedules, IDS 1.0 audit, JSON export. *Frozen, bug fixes only:* HTML viewer, glTF/OBJ export, clash, measure, grids, diff, BCF 2.1, 4D work-schedule logic | [![Docs](https://img.shields.io/badge/Docs-Online-A855F7?style=flat-square&logo=github)](https://ioextend.github.io/IfcIO/) | [![NuGet](https://img.shields.io/nuget/v/IfcIO?style=flat-square&color=A855F7&logo=nuget)](https://www.nuget.org/packages/IfcIO) | [![Release](https://img.shields.io/github/v/release/IOExtend/IfcIO?style=flat-square&color=A855F7)](https://github.com/IOExtend/IfcIO/releases) | `Electric Violet` `#A855F7` |
| **[DwgIO](https://github.com/IOExtend/DwgIO)** | `.dwg` (AutoCAD R2004, R2010, R2013, R2018) | Version detection (R13–R2018), section container and decompression, drawing metadata, thumbnail and handle map, LINE/CIRCLE/ARC/POINT geometry, JSON export. R13–R2000 and R2007 are planned | [![Docs](https://img.shields.io/badge/Docs-Online-38BDF8?style=flat-square&logo=github)](https://ioextend.github.io/DwgIO/) | [![NuGet](https://img.shields.io/nuget/v/DwgIO?style=flat-square&color=38BDF8&logo=nuget)](https://www.nuget.org/packages/DwgIO) | [![Release](https://img.shields.io/github/v/release/IOExtend/DwgIO?style=flat-square&color=38BDF8)](https://github.com/IOExtend/DwgIO/releases) | `Sky Blue` `#38BDF8` |
| **[PlaIO](https://github.com/IOExtend/PlaIO)** | `.pla`, `.pln` (Archicad 27, 29, 30), `.bimx` cover | File kind detection, container header, `BL`/`DY` block index, raw and zero-mask payload decoding, object directory search, BIMx PNG cover, text reports and directory JSON. Preview: elements, parameters and geometry are not read | [![Docs](https://img.shields.io/badge/Docs-Online-EC4899?style=flat-square&logo=github)](https://ioextend.github.io/PlaIO/) | [![NuGet](https://img.shields.io/nuget/v/PlaIO?style=flat-square&color=EC4899&logo=nuget)](https://www.nuget.org/packages/PlaIO) | [![Release](https://img.shields.io/github/v/release/IOExtend/PlaIO?style=flat-square&color=EC4899)](https://github.com/IOExtend/PlaIO/releases) | `Pink` `#EC4899` |

### Scene model and viewer

| Project | Primary Formats | Key Capabilities | Documentation | NuGet | Release | Brand Palette |
|:---|:---|:---|:---:|:---:|:---:|:---:|
| **[IOScene](https://github.com/IOExtend/IOScene)** | Scene `.json` (`"Kind": "ioscene"`) | Neutral scene model for tessellated BIM and CAD data: elements, instanced geometry, materials, typed properties, models, levels, grids, viewpoints, 4D schedules, clash results. Metres, right-handed, Z up. `SceneJson` reader/writer and `Validate()`. No dependencies. Preview: names may change before 0.1.0 | [![Docs](https://img.shields.io/badge/Docs-Contract-10B981?style=flat-square&logo=github)](https://github.com/IOExtend/IOScene/blob/main/docs/contract.md) | [![NuGet](https://img.shields.io/nuget/vpre/IOScene?style=flat-square&color=10B981&logo=nuget)](https://www.nuget.org/packages/IOScene) | [![Release](https://img.shields.io/github/v/release/IOExtend/IOScene?include_prereleases&style=flat-square&color=10B981)](https://github.com/IOExtend/IOScene/releases) | `Emerald` `#10B981` |
| **[IOViewer](https://github.com/IOExtend/IOViewer)** | `.glb`, `.obj`, JSON → `.html` | One self-contained HTML file that works offline (three.js embedded): model tree and properties, view cube, up to six section planes or a section box, distance measurement, viewpoints and tour, clash results, 4D schedule player, Russian and English interface. Reads IOScene scene files from 0.3.0 (on `main`, not yet released) | [![Docs](https://img.shields.io/badge/Docs-Online-06B6D4?style=flat-square&logo=github)](https://ioextend.github.io/IOViewer/) | [![NuGet](https://img.shields.io/nuget/v/IOViewer?style=flat-square&color=06B6D4&logo=nuget)](https://www.nuget.org/packages/IOViewer) | [![Release](https://img.shields.io/github/v/release/IOExtend/IOViewer?style=flat-square&color=06B6D4)](https://github.com/IOExtend/IOViewer/releases) | `Cyan` `#06B6D4` |

---

## Architecture

- **Engines are leaves.** RvtIO, NwcIO, IfcIO, DwgIO, and PlaIO each read their own format, and some also write it. No engine references another IOExtend package or a scene type.
- **IOScene is the neutral contract.** A scene holds what a viewer or coordination tool shows, filters, measures, or tests. It is not an authoring model, and no source file is rebuilt from it.
- **Adapters live with their engine.** `<Engine>.Scene` turns an engine's model into an IOScene `SceneDocument`. It ships on the engine's version and tag, depends on exactly that engine version, and uses only the engine's public API.
- **Consumers depend on IOScene only.** From 0.3.0 the IOViewer library references IOScene and no engine. Only command line tools combine several adapters.
- **Frozen extras.** Viewer, export, and coordination features inside IfcIO and NwcIO get bug fixes only. They stay available and are removed no earlier than that engine's 1.0, and only after a published replacement exists.

```mermaid
flowchart LR
  ifc[".ifc / .ifczip"] --> IfcIO
  rvt[".rvt / .rfa"] --> RvtIO
  nwc[".nwc / .nwd / .nwf"] --> NwcIO
  dwg[".dwg"] --> DwgIO

  IfcIO --> IfcIOScene["IfcIO.Scene"]
  RvtIO --> RvtIOScene["RvtIO.Scene"]
  NwcIO -.-> NwcIOScene["NwcIO.Scene (planned)"]
  DwgIO -.-> DwgIOScene["DwgIO.Scene (planned)"]

  IfcIOScene --> IOScene["IOScene<br/>scene model + JSON"]
  RvtIOScene --> IOScene
  NwcIOScene -.-> IOScene
  DwgIOScene -.-> IOScene

  IOScene --> IOViewer["IOViewer + ioviewer CLI"]
  IOScene -.-> IOCoord["IOCoord (planned)"]
  files[".glb / .obj / scene .json"] ---> IOViewer
  IOViewer --> html[".html viewer"]

  classDef rvt stroke:#F2A33A,stroke-width:3px
  classDef nwc stroke:#3B82F6,stroke-width:3px
  classDef ifcio stroke:#A855F7,stroke-width:3px
  classDef dwgio stroke:#38BDF8,stroke-width:3px
  classDef viewer stroke:#06B6D4,stroke-width:3px
  classDef scene stroke:#10B981,stroke-width:3px
  classDef planned stroke-dasharray: 5 5
  class RvtIO rvt
  class NwcIO nwc
  class IfcIO ifcio
  class DwgIO dwgio
  class IOViewer viewer
  class IOScene scene
  class NwcIOScene,DwgIOScene,IOCoord planned
```

Solid arrows are code that exists; dashed arrows are planned. PlaIO has no scene adapter.

| Piece | Status |
|:---|:---|
| IOScene | `0.1.0-preview.2` on NuGet; 0.1.0 is not released yet |
| IfcIO.Scene, RvtIO.Scene | Merged ([IfcIO#36](https://github.com/IOExtend/IfcIO/pull/36), [RvtIO#198](https://github.com/IOExtend/RvtIO/pull/198)); not on NuGet yet, the first release needs IOScene 0.1.0 |
| IOViewer on IOScene | Merged ([IOViewer#27](https://github.com/IOExtend/IOViewer/pull/27)) as `0.3.0-preview.1`, a breaking API change; not released, NuGet 0.2.0 still uses the older model |
| `ioviewer` with `.ifc`, `.ifczip`, `.rvt` input | Draft ([IOViewer#28](https://github.com/IOExtend/IOViewer/pull/28)) |
| NwcIO.Scene, DwgIO.Scene | Planned |
| IOScene.Formats | Planned: GLB/OBJ readers and a GLB writer over IOScene |
| IOCoord | Planned: clash, measure, grids, diff, and BCF over IOScene |

Until the adapters ship, the released tools can be chained, using IfcIO's frozen GLB export: `rvtio project.rvt project.ifc`, then `ifcio export project.ifc --glb scene.glb`, then `ioviewer scene.glb -o viewer.html`.

**Versioning.** In 0.x a patch release is additive and a minor release may break. A dependent references one IOScene line as `[0.N.0, 0.N+1.0-0)` (during the preview `[0.1.0-preview.2, 0.2.0-0)`), and an adapter pins its engine as `[X.Y.Z]`. Releases go in order: IOScene, then the engines with their adapters, then IOViewer.

---

## Architectural Principles

1. **Pure Managed .NET**:
   - No C/C++ native libraries (`.dll`, `.so`, `.dylib`).
   - Targets .NET 8 and .NET 10; the engine and viewer READMEs list Windows, Linux, and macOS as supported.
2. **No Proprietary SDK Dependencies**:
   - Works without Autodesk Revit, Autodesk Navisworks, AutoCAD, Archicad, or their APIs.
3. **Clean-Room Specification**:
   - Written independently from format analysis, ISO/buildingSMART standards, and documented specifications.
   - No decompiled or leaked source, no vendor headers or SDKs. The few open-source components, such as OpenMcdf and SharpZipLib in RvtIO and three.js in IOViewer pages, are listed in that repository's `THIRD-PARTY-NOTICES.md`.
4. **Stated Scope**:
   - Each README states the tested version range and what is not read or written; IfcIO and NwcIO also list their frozen features.

---

## Quick Start

### Installation

Install any of the libraries via the .NET CLI:

```bash
# Autodesk Revit engine
dotnet add package RvtIO

# Autodesk Navisworks engine
dotnet add package NwcIO

# buildingSMART IFC engine
dotnet add package IfcIO

# Autodesk DWG engine
dotnet add package DwgIO

# Archicad project container reader
dotnet add package PlaIO

# Neutral scene model (preview only so far)
dotnet add package IOScene --prerelease

# Standalone WebGL/HTML viewer generator
dotnet add package IOViewer
```

### Global CLI Tools

Every engine and the viewer ship a command line tool for CI/CD scripting; IOScene is a library only:

```bash
# Install the CLI tools globally
dotnet tool install --global RvtIO.Cli
dotnet tool install --global NwcIO.Cli
dotnet tool install --global IfcIO.Cli
dotnet tool install --global DwgIO.Cli
dotnet tool install --global PlaIO.Cli
dotnet tool install --global IOViewer.Cli

# Export a Revit project to IFC
rvtio project.rvt project.ifc

# Convert a Navisworks model to binary glTF
nwcio model.nwc model.glb

# Run clash detection over a folder of Navisworks models with BCF output
nwcio ./models --clash-bcf clashes.bcfzip --clash-tolerance 0.01

# Inspect an IFC model
ifcio info Building.ifc --report

# Inspect a DWG drawing
dwgio inspect drawing.dwg

# Inspect an Archicad project file
plaio info project.pln

# Generate a standalone HTML viewer from a GLB model
ioviewer model.glb -o viewer.html
```

Direct `.ifc`, `.ifczip`, and `.rvt` input for `ioviewer` is coming with the scene adapters ([IOViewer#28](https://github.com/IOExtend/IOViewer/pull/28), draft).

---

## Security & Clean-Room Governance

- All repositories in the **IOExtend** organization follow a clean-room policy.
- Repositories contain **no confidential customer models, vendor files, or proprietary binaries**.
- Tests that need real model files (RvtIO, NwcIO, DwgIO, PlaIO) read them from a local folder named by a `*_TEST_FILES` environment variable. CI does not set it, so those tests are skipped there.
- Every public code repository has a `SECURITY.md`. Report vulnerabilities through GitHub private vulnerability reporting (the repository's **Security** tab, **Report a vulnerability**), which is enabled in every public code repository. Please do not open a public issue for a security problem.

---

<div align="center">
  <sub>Each project is released under the MIT License; see the LICENSE file in its repository. Trademarks belong to their respective owners.</sub>
</div>
