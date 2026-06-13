"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.safeExtractZip = safeExtractZip;
exports.readZipEntries = readZipEntries;
exports.createZipFromDir = createZipFromDir;
const adm_zip_1 = __importDefault(require("adm-zip"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const MAX_ZIP_SIZE = 200 * 1024 * 1024; // 200 MB
const MAX_FILE_COUNT = 10000;
function safeExtractZip(zipPath, destDir) {
    const stat = fs_1.default.statSync(zipPath);
    if (stat.size > MAX_ZIP_SIZE) {
        throw new Error(`Zip file too large: ${stat.size} bytes (max ${MAX_ZIP_SIZE})`);
    }
    const zip = new adm_zip_1.default(zipPath);
    const entries = zip.getEntries();
    if (entries.length > MAX_FILE_COUNT) {
        throw new Error(`Too many files in zip: ${entries.length} (max ${MAX_FILE_COUNT})`);
    }
    for (const entry of entries) {
        const entryName = entry.entryName;
        // Security: reject absolute paths and path traversal
        if (path_1.default.isAbsolute(entryName)) {
            throw new Error(`Absolute path in zip: ${entryName}`);
        }
        const normalized = path_1.default.normalize(entryName);
        if (normalized.startsWith('..')) {
            throw new Error(`Path traversal in zip: ${entryName}`);
        }
        const dest = path_1.default.join(destDir, normalized);
        // Ensure dest is inside destDir
        const rel = path_1.default.relative(destDir, dest);
        if (rel.startsWith('..') || path_1.default.isAbsolute(rel)) {
            throw new Error(`Path escapes destination: ${entryName}`);
        }
        if (entry.isDirectory) {
            fs_1.default.mkdirSync(dest, { recursive: true });
        }
        else {
            fs_1.default.mkdirSync(path_1.default.dirname(dest), { recursive: true });
            fs_1.default.writeFileSync(dest, entry.getData());
        }
    }
}
function readZipEntries(zipPath) {
    const stat = fs_1.default.statSync(zipPath);
    if (stat.size > MAX_ZIP_SIZE) {
        throw new Error(`Zip file too large`);
    }
    const zip = new adm_zip_1.default(zipPath);
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
function createZipFromDir(sourceDir, outputPath) {
    const zip = new adm_zip_1.default();
    addDirToZip(zip, sourceDir, '');
    zip.writeZip(outputPath);
}
function addDirToZip(zip, dirPath, zipPath) {
    const entries = fs_1.default.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path_1.default.join(dirPath, entry.name);
        const zipEntry = zipPath ? `${zipPath}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            addDirToZip(zip, fullPath, zipEntry);
        }
        else {
            zip.addFile(zipEntry, fs_1.default.readFileSync(fullPath));
        }
    }
}
