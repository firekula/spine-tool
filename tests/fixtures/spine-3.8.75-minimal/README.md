# Spine 3.8.75 minimal regression fixtures

These synthetic fixtures contain no user artwork or exported project data. `minimal.json`
declares one root bone. `minimal.skel` encodes the equivalent smallest useful structure in
the field order read by the pinned official Spine 3.8 `SkeletonBinary` implementation.

Regenerate the binary fixture with:

```sh
node tests/fixtures/spine-3.8.75-minimal/generate-skel.mjs
```
