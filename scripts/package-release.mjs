import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");
const outputName = "Cosmic-Catchers-direct-file.zip";
const manifest = JSON.parse(await readFile(path.join(root, "baseline-manifest.json"), "utf8"));
const names = ["## JOGUE AQUI.html", ...manifest.assets.map((asset) => asset.name), "SHA256SUMS"];

function makeCrcTable() {
  return Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
    return value >>> 0;
  });
}

const crcTable = makeCrcTable();

function crc32(contents) {
  let value = 0xffffffff;
  for (const byte of contents) value = crcTable[(value ^ byte) & 0xff] ^ value >>> 8;
  return (value ^ 0xffffffff) >>> 0;
}

function localHeader({ filename, contents, checksum }) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt32LE(checksum, 14);
  header.writeUInt32LE(contents.length, 18);
  header.writeUInt32LE(contents.length, 22);
  header.writeUInt16LE(filename.length, 26);
  return header;
}

function centralHeader({ filename, contents, checksum, offset }) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt32LE(checksum, 16);
  header.writeUInt32LE(contents.length, 20);
  header.writeUInt32LE(contents.length, 24);
  header.writeUInt16LE(filename.length, 28);
  header.writeUInt32LE(offset, 42);
  return header;
}

function endRecord({ entries, centralSize, centralOffset }) {
  const record = Buffer.alloc(22);
  record.writeUInt32LE(0x06054b50, 0);
  record.writeUInt16LE(entries, 8);
  record.writeUInt16LE(entries, 10);
  record.writeUInt32LE(centralSize, 12);
  record.writeUInt32LE(centralOffset, 16);
  return record;
}

async function makeEntry(name, offset) {
  const contents = await readFile(path.join(dist, name));
  const filename = Buffer.from(name, "utf8");
  const checksum = crc32(contents);
  const local = Buffer.concat([localHeader({ filename, contents, checksum }), filename, contents]);
  const central = Buffer.concat([centralHeader({ filename, contents, checksum, offset }), filename]);
  return { central, local, name };
}

const entries = [];
let offset = 0;
for (const name of names) {
  const entry = await makeEntry(name, offset);
  entries.push(entry);
  offset += entry.local.length;
}
const localData = Buffer.concat(entries.map((entry) => entry.local));
const centralData = Buffer.concat(entries.map((entry) => entry.central));
const archive = Buffer.concat([
  localData,
  centralData,
  endRecord({ entries: entries.length, centralSize: centralData.length, centralOffset: localData.length })
]);
await writeFile(path.join(dist, outputName), archive);

const endOffset = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
if (endOffset < 0 || archive.readUInt16LE(endOffset + 10) !== names.length) throw new Error("Release ZIP directory is incomplete.");
if (entries.some((entry) => entry.name.includes("/") || entry.name.includes("\\"))) throw new Error("Release ZIP must contain only root-level files.");
console.log(`Packaged dist/${outputName} (${archive.length} bytes, ${entries.length} root files).`);
