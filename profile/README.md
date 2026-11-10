<div align="center">

<img src="https://raw.githubusercontent.com/IOExtend/.github/main/profile/banner.png" alt="IOExtend Banner" width="100%" style="max-width: 960px; border-radius: 12px;" />

# IOExtend

**High-performance, pure managed .NET libraries and cross-platform CLI tools for BIM and CAD interoperability.**

*Read, analyze, convert, and federate complex building models without proprietary runtime licenses, native wrappers, or CAD software installed.*

---

[![GitHub Organization](https://img.shields.io/badge/GitHub-IOExtend-181717?style=flat-square&logo=github)](https://github.com/IOExtend)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Platform](https://img.shields.io/badge/.NET-8.0%20%7C%2010.0-512BD4?style=flat-square&logo=dotnet)](https://dotnet.microsoft.com/)
[![Clean-Room](https://img.shields.io/badge/Specification-Clean--Room-10B981?style=flat-square)](https://github.com/IOExtend)

</div>

<br/>

## The Ecosystem

IOExtend provides a unified suite of independent, zero-dependency .NET engines designed for high-throughput cloud microservices, CI/CD pipelines, web backends, and desktop engineering software.

| Project | Primary Formats | Key Capabilities | NuGet | Release | Brand Palette |
|:---|:---|:---|:---:|:---:|:---:|
| **[RvtIO](https://github.com/mahach666/RvtIO)** | `.rvt`, `.rfa` (2020–2026) | Full Revit OLE/Compound file container extraction, element tables, geometry, schema decoders, parameter reflection | [![NuGet](https://img.shields.io/nuget/v/RvtIO?style=flat-square&color=F2A33A&logo=nuget)](https://www.nuget.org/packages/RvtIO) | [![Release](https://img.shields.io/github/v/release/mahach666/RvtIO?style=flat-square&color=F2A33A)](https://github.com/mahach666/RvtIO/releases) | `Amber` `#F2A33A` |
| **[NwcIO](https://github.com/IOExtend/NwcIO)** | `.nwc`, `.nwd`, `.nwf` | Navisworks binary `#LcUStream` parser, 3D mesh reconstruction, BVH spatial index, clash detection, IFC4/glTF/BCF exporters | [![NuGet](https://img.shields.io/nuget/v/NwcIO?style=flat-square&color=3B82F6&logo=nuget)](https://www.nuget.org/packages/NwcIO) | [![Release](https://img.shields.io/github/v/release/IOExtend/NwcIO?style=flat-square&color=3B82F6)](https://github.com/IOExtend/NwcIO/releases) | `Azure Blue` `#3B82F6` |
| **[IfcIO](https://github.com/IOExtend/IfcIO)** | `.ifc`, `.ifczip` | Pure managed ISO 10303-21 STEP engine for buildingSMART IFC2x3 & IFC4 schemas, faceted B-Rep and modern tessellation | [![NuGet](https://img.shields.io/nuget/v/IfcIO?style=flat-square&color=A855F7&logo=nuget)](https://www.nuget.org/packages/IfcIO) | [![Release](https://img.shields.io/github/v/release/IOExtend/IfcIO?style=flat-square&color=A855F7)](https://github.com/IOExtend/IfcIO/releases) | `Electric Violet` `#A855F7` |

---

## Architectural Principles

```
  ┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
  │      RvtIO      │       │      NwcIO      │       │      IfcIO      │
  │  Revit Engine   │       │Navisworks Engine│       │   IFC Engine    │
  └────────┬────────┘       └────────┬────────┘       └────────┬────────┘
           │                         │                         │
           └─────────────────────────┼─────────────────────────┘
                                     ▼
                     ┌───────────────────────────────┐
                     │   Pure Managed .NET 8 / 10    │
                     │   Zero Native Dependencies    │
                     │   Cross-Platform (Linux/Win)  │
                     └───────────────────────────────┘
```

1. **100% Pure Managed .NET**:
   - Zero C/C++ native dynamic libraries (`.dll`, `.so`, `.dylib`).
   - Runs seamlessly inside minimal Alpine Linux Docker containers, AWS Lambda, Azure Functions, macOS ARM64/x64, and Windows.
2. **Zero Proprietary SDK Dependencies**:
   - Operates completely standalone without Autodesk Revit, Autodesk Navisworks, or closed-source license daemons.
3. **Clean-Room Specification**:
   - All engines are authored from scratch using first-principles format analysis, official ISO/buildingSMART standards, and documented specifications.
   - Zero copyrighted code, zero decompiled source, and zero vendor header files.
4. **Extreme Performance**:
   - Streaming zlib and Deflate decompression without memory spikes.
   - Sub-second parsing of multi-hundred megabyte models with tens of thousands of geometry meshes.

---

## Quick Start

### Installation

Install any of the packages via the .NET CLI:

```bash
# Autodesk Revit engine
dotnet add package RvtIO

# Autodesk Navisworks engine & CLI
dotnet add package NwcIO
dotnet add package NwcIO.Cli

# buildingSMART IFC engine
dotnet add package IfcIO
```

### Global CLI Tools

All engines feature lightweight command-line utilities for CI/CD scripting:

```bash
# Install Navisworks CLI globally
dotnet tool install --global NwcIO.Cli

# Inspect file metadata
nwcio info model.nwc --report

# Export to modern IFC4 and binary glTF
nwcio export model.nwc --ifc4 building.ifc --glb scene.glb

# Multi-model clash detection
nwcio clash campus_folder/ --report clashes.html --bcf issues.bcfzip
```

---

## Security & Clean-Room Governance

- All repositories in the **IOExtend** organization strictly enforce clean-room policies.
- Repositories contain **no confidential customer models, vendor files, or proprietary binaries**.
- Automated CI workflows test against procedural synthetic data and isolated local environment fixtures (`*_TEST_FILES`).
- For security inquiries, please review the `SECURITY.md` file in each repository.

---

<div align="center">
  <sub>Copyright &copy; 2026 IOExtend. All rights reserved. Trademarks belong to their respective owners.</sub>
</div>
