import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { db, getProblemDir, getPackagesDir } from '../db/schema';
import {
  getProblem, getAsset, listSolutions, getTestset, listTests,
  listFiles, listExecutables, listTags, listStatements, getProblemNames,
  listProperties, getTestGroups, getGroupDependencies,
  listCheckerTests, listValidatorTests,
} from '../services/problems';
import { generateProblemXml } from '../polygon-xml/generator';
import { compileAsset, compileSolution, generateTestInput, generateTestAnswer } from '../judging/judging';
import type { ProblemXmlModel, StatementEntry, TutorialEntry } from '../polygon-xml/types';

export type PackageType = 'standard' | 'linux' | 'windows';

interface BuildOptions {
  type: PackageType;
  comment?: string;
}

export async function buildPackage(
  problemId: number,
  packageId: number,
  options: BuildOptions
): Promise<void> {
  db.prepare("UPDATE packages SET state = 'RUNNING' WHERE id = ?").run(packageId);

  try {
    const problemDir = getProblemDir(problemId);
    const packagesDir = getPackagesDir();
    fs.mkdirSync(packagesDir, { recursive: true });

    const problem = getProblem(problemId);
    if (!problem) throw new Error('Problem not found');

    const outputPath = path.join(packagesDir, `${packageId}_${problem.short_name}$${options.type}.zip`);
    const tmpDir = path.join(packagesDir, `build_${packageId}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
      await assemblePackage(problemId, tmpDir, options.type, problem);
      createZipFromDir(tmpDir, outputPath);
      db.prepare("UPDATE packages SET state = 'READY', file_path = ? WHERE id = ?").run(outputPath, packageId);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  } catch (e) {
    db.prepare("UPDATE packages SET state = 'FAILED' WHERE id = ?").run(packageId);
    throw e;
  }
}

async function assemblePackage(
  problemId: number,
  destDir: string,
  type: PackageType,
  problem: ReturnType<typeof getProblem>
): Promise<void> {
  if (!problem) throw new Error('Problem is null');
  const problemDir = getProblemDir(problemId);

  // Copy all problem files to destDir (the top-level tests/ dir is skipped here
  // and rebuilt below from the current test list).
  copyAllFiles(problemDir, destDir, type);

  // Materialize exactly the tests that currently exist (idx 1..N), so no stale
  // files from deleted/renumbered tests get included. Per Polygon's conventions:
  //   • standard           — only manual tests' inputs (generated ones are
  //                            re-created on the target from the scripts);
  //   • linux / windows     — every test's input and answer (generated as needed).
  await materializeTests(problemId, destDir, type, problem);

  // Write validator/checker test inputs referenced by problem.xml, in case they
  // are not already present on disk (e.g. locally authored problems).
  writeValidatorAndCheckerTests(problemId, destDir);

  // Generate problem.xml
  const model = buildProblemXmlModel(problemId, problem, type);
  const xmlContent = generateProblemXml(model);
  fs.writeFileSync(path.join(destDir, 'problem.xml'), xmlContent, 'utf-8');

  // Generate tags file
  const tags = listTags(problemId);
  if (tags.length > 0) {
    fs.writeFileSync(path.join(destDir, 'tags'), tags.join('\n') + '\n', 'utf-8');
  }

  // The checker's `<copy>` (e.g. check.cpp at the root) is a copy of the checker
  // *source* and is taken verbatim from disk by copyAllFiles. Ensure it is
  // present even if it was never materialized on disk.
  const checker = getAsset(problemId, 'checker');
  if (checker && checker.copy_path && checker.source_path) {
    const copyDest = path.join(destDir, checker.copy_path);
    const srcOnDisk = path.join(problemDir, checker.source_path);
    if (!fs.existsSync(copyDest) && fs.existsSync(srcOnDisk)) {
      fs.mkdirSync(path.dirname(copyDest), { recursive: true });
      fs.copyFileSync(srcOnDisk, copyDest);
    }
  }

  ensureScriptsDir(destDir);
}

function copyAllFiles(sourceDir: string, destDir: string, type: PackageType): void {
  if (!fs.existsSync(sourceDir)) return;

  const skipForLinux = new Set(['.exe', '.bat']);
  const skipForStandard = new Set<string>();

  function copyRec(src: string, dst: string, relPath: string): void {
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
      // Skip the volatile workdir and the top-level tests/ directory — the
      // latter is materialized explicitly from the current test list so stale
      // files from deleted/renumbered tests never leak into the package.
      if (path.basename(src) === 'workdir') return;
      if (relPath === 'tests') return;
      fs.mkdirSync(dst, { recursive: true });
      for (const e of fs.readdirSync(src)) {
        copyRec(path.join(src, e), path.join(dst, e), relPath ? `${relPath}/${e}` : e);
      }
    } else {
      const ext = path.extname(src).toLowerCase();
      if (type === 'linux' && skipForLinux.has(ext)) return;
      // Polygon omits empty statement section files (e.g. an unused scoring.tex
      // / interaction.tex); skip them so the package matches.
      if (relPath.startsWith('statement-sections/') && ext === '.tex' && stat.size === 0) return;
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    }
  }

  copyRec(sourceDir, destDir, '');
}

// Rebuild the package's tests/ directory from the current test list only, so it
// contains exactly tests 1..N and nothing stale.
async function materializeTests(
  problemId: number,
  destDir: string,
  type: PackageType,
  problem: NonNullable<ReturnType<typeof getProblem>>,
): Promise<void> {
  const testset = getTestset(problemId, 'tests');
  if (!testset) return;
  const tests = listTests(testset.id);
  const problemDir = getProblemDir(problemId);
  const inputPattern = testset.input_path_pattern;
  const answerPattern = testset.answer_path_pattern;
  const timeLimitMs = testset.time_limit ?? problem.time_limit;
  const memLimitBytes = testset.memory_limit ?? problem.memory_limit;

  for (const t of tests) {
    const testNum = String(t.idx).padStart(2, '0');
    const srcInput = path.join(problemDir, inputPattern.replace('%02d', testNum));
    const srcAnswer = path.join(problemDir, answerPattern.replace('%02d', testNum));
    const dstInput = path.join(destDir, inputPattern.replace('%02d', testNum));
    const dstAnswer = path.join(destDir, answerPattern.replace('%02d', testNum));
    fs.mkdirSync(path.dirname(dstInput), { recursive: true });

    if (type === 'standard') {
      // Standard packages ship only manual inputs; generated tests (and all
      // answers) are reproduced on the target via the scripts.
      if (t.method !== 'generated' && fs.existsSync(srcInput)) fs.copyFileSync(srcInput, dstInput);
      continue;
    }

    // Full packages: ship every input and answer, generating any that are missing.
    if (fs.existsSync(srcInput)) {
      fs.copyFileSync(srcInput, dstInput);
    } else if (t.method === 'generated' && t.cmd) {
      const gen = await generateTestInput(problemId, testset.id, t.idx);
      if (gen.success) fs.copyFileSync(gen.inputPath, dstInput);
    }
    if (fs.existsSync(dstInput)) {
      if (fs.existsSync(srcAnswer)) {
        fs.copyFileSync(srcAnswer, dstAnswer);
      } else {
        const ans = await generateTestAnswer(problemId, dstInput, timeLimitMs, memLimitBytes);
        if (ans.success) fs.copyFileSync(ans.answerPath, dstAnswer);
      }
    }
  }
}

// Ensure the validator/checker test inputs referenced by problem.xml exist on
// disk. They are normally copied from the problem dir; write them from the DB
// only when missing (e.g. locally authored problems).
function writeValidatorAndCheckerTests(problemId: number, destDir: string): void {
  const vts = listValidatorTests(problemId, 0);
  if (vts.length > 0) {
    const dir = path.join(destDir, 'files', 'tests', 'validator-tests');
    fs.mkdirSync(dir, { recursive: true });
    for (const vt of vts) {
      const p = path.join(dir, String(vt.idx).padStart(2, '0'));
      if (!fs.existsSync(p)) fs.writeFileSync(p, vt.input ?? '', 'utf-8');
    }
  }
  const cts = listCheckerTests(problemId);
  if (cts.length > 0) {
    const dir = path.join(destDir, 'files', 'tests', 'checker-tests');
    fs.mkdirSync(dir, { recursive: true });
    for (const ct of cts) {
      const base = path.join(dir, String(ct.idx).padStart(2, '0'));
      if (!fs.existsSync(base)) fs.writeFileSync(base, ct.input ?? '', 'utf-8');
      if (ct.output_data && !fs.existsSync(base + '.o')) fs.writeFileSync(base + '.o', ct.output_data, 'utf-8');
      if (ct.answer && !fs.existsSync(base + '.a')) fs.writeFileSync(base + '.a', ct.answer, 'utf-8');
    }
  }
}

// Ensure the (conventional) scripts/ directory exists. Polygon's real helper
// scripts are kept as-is when present on disk; we never fabricate stub scripts
// (they are not part of a valid package and just add noise).
function ensureScriptsDir(destDir: string): void {
  fs.mkdirSync(path.join(destDir, 'scripts'), { recursive: true });
}

function buildProblemXmlModel(
  problemId: number,
  problem: NonNullable<ReturnType<typeof getProblem>>,
  type: PackageType
): ProblemXmlModel {
  const names = getProblemNames(problemId).map(n => ({ language: n.language, value: n.value }));
  const tags = listTags(problemId);
  const properties = listProperties(problemId);
  const stmts = listStatements(problemId) as Array<{ language: string }>;
  const solutions = listSolutions(problemId);

  const testset = getTestset(problemId, 'tests');
  const tests = testset ? listTests(testset.id) : [];
  const groups = testset ? getTestGroups(testset.id) : [];

  const testsetModel = testset ? {
    name: 'tests',
    timeLimit: testset.time_limit ?? problem.time_limit,
    memoryLimit: testset.memory_limit ?? problem.memory_limit,
    testCount: tests.length,
    inputPathPattern: testset.input_path_pattern,
    answerPathPattern: testset.answer_path_pattern,
    tests: tests.map(t => ({
      method: t.method as 'manual' | 'generated',
      cmd: t.cmd || undefined,
      description: t.description || undefined,
      sample: t.sample === 1 ? true : undefined,
      group: t.group_name || undefined,
      points: t.points > 0 ? t.points : undefined,
      _extraAttrs: JSON.parse(t.extra_attrs || '{}'),
    })),
    groups: groups.map(g => ({
      name: g.name,
      points: g.points,
      pointsPolicy: g.points_policy,
      feedbackPolicy: g.feedback_policy,
      dependencies: getGroupDependencies(g.id),
      _extraAttrs: JSON.parse(g.extra_attrs || '{}'),
    })),
  } : {
    name: 'tests',
    timeLimit: problem.time_limit,
    memoryLimit: problem.memory_limit,
    testCount: 0,
    inputPathPattern: 'tests/%02d',
    answerPathPattern: 'tests/%02d.a',
    tests: [],
    groups: [],
  };

  const checker = getAsset(problemId, 'checker');
  const validator = getAsset(problemId, 'validator');
  const interactor = getAsset(problemId, 'interactor');

  const checkerTests = listCheckerTests(problemId);
  const validatorTests = listValidatorTests(problemId, 0);

  const binaryExt = type === 'windows' ? '.exe' : '';
  const binaryType = type === 'windows' ? 'exe.win32' : '';

  const execsList = listExecutables(problemId);
  const filesList = listFiles(problemId);
  const resources = filesList.filter(f => f.file_role === 'resource').map(f => ({
    path: f.path,
    type: f.source_type || undefined,
    forTypes: f.for_types || undefined,
    stages: f.stages || undefined,
    assets: f.assets_attr || undefined,
    main: f.is_main ? 'true' : undefined,
    _extraAttrs: JSON.parse(f.extra_attrs || '{}'),
  }));

  const executables = execsList.map(e => ({
    source: e.source_path ? { path: e.source_path, type: e.source_type } : undefined,
    binary: e.binary_path ? { path: e.binary_path, type: e.binary_type } : undefined,
  }));

  // Build statements/tutorials lists. Each is emitted as tex, then html and pdf
  // only when those rendered files actually exist on disk (so the package never
  // references a missing file). Order matches Polygon: tex, html, pdf.
  const problemDirForXml = getProblemDir(problemId);
  const exists = (rel: string) => fs.existsSync(path.join(problemDirForXml, rel));

  const statements = stmts.flatMap(s => {
    const entries: StatementEntry[] = [];
    entries.push({ language: s.language, path: `statements/${s.language}/problem.tex`, type: 'application/x-tex', charset: 'UTF-8', mathjax: 'true' });
    const htmlPath = `statements/.html/${s.language}/problem.html`;
    if (exists(htmlPath)) entries.push({ language: s.language, path: htmlPath, type: 'text/html', charset: 'UTF-8', mathjax: 'true' });
    const pdfPath = `statements/.pdf/${s.language}/problem.pdf`;
    if (exists(pdfPath)) entries.push({ language: s.language, path: pdfPath, type: 'application/pdf' });
    return entries;
  });

  const tutorials = stmts.flatMap(s => {
    const entries: TutorialEntry[] = [];
    const texPath = `statements/${s.language}/tutorial.tex`;
    if (exists(texPath)) entries.push({ language: s.language, path: texPath, type: 'application/x-tex', charset: 'UTF-8', mathjax: 'true' });
    const htmlPath = `statements/.html/${s.language}/tutorial.html`;
    if (exists(htmlPath)) entries.push({ language: s.language, path: htmlPath, type: 'text/html', charset: 'UTF-8', mathjax: 'true' });
    const pdfPath = `statements/.pdf/${s.language}/tutorial.pdf`;
    if (exists(pdfPath)) entries.push({ language: s.language, path: pdfPath, type: 'application/pdf' });
    return entries;
  });

  return {
    revision: String(problem.revision),
    shortName: problem.short_name,
    url: problem.polygon_url || undefined,
    names,
    statements,
    tutorials,
    // Polygon always tags these container elements; mirror it for a faithful format.
    ...(statements.length > 0 ? { _statementsEl: { 'latex-pdf-mode': 'obsolete' } } : {}),
    ...(tutorials.length > 0 ? { _tutorialsEl: { 'latex-pdf-mode': 'obsolete' } } : {}),
    judging: {
      inputFile: problem.input_file,
      outputFile: problem.output_file,
      runCount: problem.run_count,
      cpuName: problem.cpu_name || undefined,
      cpuSpeed: problem.cpu_speed || undefined,
      testsets: [testsetModel],
    },
    files: { resources, executables },
    assets: {
      checker: checker ? {
        name: checker.name || undefined,
        type: checker.checker_type || 'testlib',
        source: checker.source_path ? { path: checker.source_path, type: checker.source_type } : undefined,
        binary: checker.binary_path ? { path: checker.binary_path, type: checker.binary_type } : undefined,
        copy: checker.copy_path ? { path: checker.copy_path, type: checker.copy_type || undefined } : undefined,
        testset: {
          testCount: checkerTests.length,
          inputPathPattern: 'files/tests/checker-tests/%02d',
          outputPathPattern: 'files/tests/checker-tests/%02d.o',
          answerPathPattern: 'files/tests/checker-tests/%02d.a',
          tests: checkerTests.map(ct => ({ verdict: ct.expected_verdict || undefined })),
        },
      } : undefined,
      validators: validator ? [{
        source: validator.source_path ? { path: validator.source_path, type: validator.source_type } : undefined,
        binary: validator.binary_path ? { path: validator.binary_path, type: validator.binary_type } : undefined,
        testset: {
          testCount: validatorTests.length,
          inputPathPattern: 'files/tests/validator-tests/%02d',
          tests: validatorTests.map(vt => ({ verdict: vt.expected_verdict || undefined })),
        },
      }] : [],
      interactor: interactor ? {
        source: interactor.source_path ? { path: interactor.source_path, type: interactor.source_type } : undefined,
        binary: interactor.binary_path ? { path: interactor.binary_path, type: interactor.binary_type } : undefined,
      } : undefined,
      solutions: solutions.map(s => ({
        tag: s.tag,
        source: s.source_path ? { path: s.source_path, type: s.source_type } : undefined,
        binary: s.binary_path ? { path: s.binary_path, type: s.binary_type } : undefined,
      })),
    },
    properties: properties,
    stresses: {
      stressCount: 0,
      stressPathPattern: 'stresses/%03d',
      list: [],
    },
    tags,
  };
}

function createZipFromDir(sourceDir: string, outputPath: string): void {
  const zip = new AdmZip();

  function addDir(dirPath: string, zipPath: string): void {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const zipEntry = zipPath ? `${zipPath}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        // Emit an explicit directory entry (as Polygon packages do) before its
        // contents.
        zip.addFile(`${zipEntry}/`, Buffer.alloc(0));
        addDir(fullPath, zipEntry);
      } else {
        zip.addFile(zipEntry, fs.readFileSync(fullPath));
      }
    }
  }

  addDir(sourceDir, '');
  zip.writeZip(outputPath);
}
