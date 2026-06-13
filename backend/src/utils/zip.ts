import AdmZip from 'adm-zip';
import path from 'path';
import fs from 'fs';

const MAX_ZIP_SIZE = 200 * 1024 * 1024; // 200 MB
const MAX_FILE_COUNT = 10000;

export interface ZipEntry {
  entryName: string;
  data: Buffer;
  isDirectory: boolean;
}

export function safeExtractZip(zipPath: string, destDir: string): void {
  const stat = fs.statSync(zipPath);
  if (stat.size > MAX_ZIP_SIZE) {
    throw new Error(`Zip file too large: ${stat.size} bytes (max ${MAX_ZIP_SIZE})`);
  }

  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  if (entries.length > MAX_FILE_COUNT) {
    throw new Error(`Too many files in zip: ${entries.length} (max ${MAX_FILE_COUNT})`);
  }

  for (const entry of entries) {
    const entryName = entry.entryName;

    // Security: reject absolute paths and path traversal
    if (path.isAbsolute(entryName)) {
      throw new Error(`Absolute path in zip: ${entryName}`);
    }
    const normalized = path.normalize(entryName);
    if (normalized.startsWith('..')) {
      throw new Error(`Path traversal in zip: ${entryName}`);
    }

    const dest = path.join(destDir, normalized);

    // Ensure dest is inside destDir
    const rel = path.relative(destDir, dest);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Path escapes destination: ${entryName}`);
    }

    if (entry.isDirectory) {
      fs.mkdirSync(dest, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, entry.getData());
    }
  }
}

export function readZipEntries(zipPath: string): ZipEntry[] {
  const stat = fs.statSync(zipPath);
  if (stat.size > MAX_ZIP_SIZE) {
    throw new Error(`Zip file too large`);
  }

  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  if (entries.length > MAX_FILE_COUNT) {
    throw new Error(`Too many files in zip`);
  }

  return entries.map(e => ({
    entryName: e.entryName,
    data: e.isDirectory ? Buffer.alloc(0) : e.getData(),
    isDirectory: e.isDirectory,
  }));
}

export function createZipFromDir(sourceDir: string, outputPath: string): void {
  const zip = new AdmZip();
  addDirToZip(zip, sourceDir, '');
  zip.writeZip(outputPath);
}

function addDirToZip(zip: AdmZip, dirPath: string, zipPath: string): void {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const zipEntry = zipPath ? `${zipPath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      addDirToZip(zip, fullPath, zipEntry);
    } else {
      zip.addFile(zipEntry, fs.readFileSync(fullPath));
    }
  }
}
