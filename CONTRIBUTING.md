# Contributing to IOExtend

This is the default contributing guide for IOExtend repositories that do not carry their own `CONTRIBUTING.md`.
Each library and tool repository has a `CONTRIBUTING.md` with the details for that project; read it first.

## Clean-room rule

All code is written independently from the analysis of files for interoperability, ISO and buildingSMART standards, and
documented specifications. Do not add vendor code, SDKs, SDK internals, headers or binaries, decompiled or leaked
source, or code copied from other implementations. Do not add customer models or other confidential data, or names,
paths, sizes, GUIDs or other details of private sample files to a repository, including tests, comments and
documentation. Test inputs are built synthetically; tests that need private files read them from folders named by
environment variables and are skipped when those folders are not set.

Do not put personal data in code, documentation, test data or commit metadata. Use your GitHub noreply address as the
commit email.

## Licensing contributions

All contributions are licensed under the MIT License of the repository they go to. By submitting a pull request, you
confirm that you have the right to contribute your code under that license.
