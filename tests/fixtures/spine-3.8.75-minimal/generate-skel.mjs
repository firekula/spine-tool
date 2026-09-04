import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const bytes = [];

function writeByte(value) {
  bytes.push(value & 0xff);
}

function writeVarint(value) {
  let remaining = value >>> 0;
  while (true) {
    const next = remaining & 0x7f;
    remaining >>>= 7;
    writeByte(remaining === 0 ? next : next | 0x80);
    if (remaining === 0) return;
  }
}

function writeString(value) {
  if (value === null) {
    writeVarint(0);
    return;
  }
  const encoded = new TextEncoder().encode(value);
  writeVarint(encoded.length + 1);
  bytes.push(...encoded);
}

function writeFloat(value) {
  const buffer = new ArrayBuffer(4);
  new DataView(buffer).setFloat32(0, value);
  bytes.push(...new Uint8Array(buffer));
}

// Spine 3.8 SkeletonBinary header.
writeString(null); // hash
writeString("3.8.75");
writeFloat(0); // x
writeFloat(0); // y
writeFloat(0); // width
writeFloat(0); // height
writeByte(0); // nonessential

writeVarint(0); // shared strings
writeVarint(1); // bones
writeString("root");
writeFloat(0); // rotation
writeFloat(0); // x
writeFloat(0); // y
writeFloat(1); // scaleX
writeFloat(1); // scaleY
writeFloat(0); // shearX
writeFloat(0); // shearY
writeFloat(0); // length
writeVarint(0); // transform mode: normal
writeByte(0); // skin required

writeVarint(0); // slots
writeVarint(0); // IK constraints
writeVarint(0); // transform constraints
writeVarint(0); // path constraints
writeVarint(0); // default skin slots
writeVarint(0); // additional skins
writeVarint(0); // events
writeVarint(0); // animations

const fixtureDirectory = dirname(fileURLToPath(import.meta.url));
await writeFile(resolve(fixtureDirectory, "minimal.skel"), Uint8Array.from(bytes));
