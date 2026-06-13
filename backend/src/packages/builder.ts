import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { db, getProblemDir, getPackagesDir } from '../db/schema';
import {
  getProblem, getAsset, listSolutions, getTestset, listTests,
  listFiles, listExecutables, listTags, listStatements, getProblemNames,
  listProperties, getTestGroups, getGroupDependencies,
} from '../services/problems';
import { generateProblemXml } from '../polygon-xml/generator';
import { compileAsset, compileSolution, generateTestInput, generateTestAnswer } from '../judging/judging';
import type { ProblemXmlModel } from '../polygon-xml/types';

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

  // Copy all problem files to destDir
  copyAllFiles(problemDir, destDir, type);

  // For linux/windows packages, generate all tests
  const testset = getTestset(problemId, 'tests');
  if (testset && (type === 'linux' || type === 'windows')) {
    const tests = listTests(testset.id);
    const inputPattern = testset.input_path_pattern;
    const answerPattern = testset.answer_path_pattern;
    const timeLimitMs = testset.time_limit ?? problem.time_limit;
    const memLimitBytes = testset.memory_limit ?? problem.memory_limit;

    for (const t of tests) {
      const testNum = String(t.idx).padStart(2, '0');
      const inputDest = path.join(destDir, inputPattern.replace('%02d', testNum));
      const answerDest = path.join(destDir, answerPattern.replace('%02d', testNum));

      // Input
      if (!fs.existsSync(inputDest)) {
        if (t.method === 'generated' && t.cmd) {
          const genResult = await generateTestInput(problemId, testset.id, t.idx);
          if (genResult.success) {
            fs.mkdirSync(path.dirname(inputDest), { recursive: true });
            fs.copyFileSync(genResult.inputPath, inputDest);
          }
        }
      }

      // Answer
      if (!fs.existsSync(answerDest) && fs.existsSync(inputDest)) {
        const genAns = await generateTestAnswer(problemId, inputDest, timeLimitMs, memLimitBytes);
        if (genAns.success) {
          fs.mkdirSync(path.dirname(answerDest), { recursive: true });
          fs.copyFileSync(genAns.answerPath, answerDest);
        }
      }
    }
  }

  // Generate problem.xml
  const model = buildProblemXmlModel(problemId, problem, type);
  const xmlContent = generateProblemXml(model);
  fs.writeFileSync(path.join(destDir, 'problem.xml'), xmlContent, 'utf-8');

  // Generate tags file
  const tags = listTags(problemId);
  if (tags.length > 0) {
    fs.writeFileSync(path.join(destDir, 'tags'), tags.join('\n') + '\n', 'utf-8');
  }

  // For standard/linux: compile checker to local binary
  const checker = getAsset(problemId, 'checker');
  if (checker && checker.source_path) {
    const compileResult = await compileAsset(problemId, 'checker');
    if (compileResult.success) {
      const updatedChecker = getAsset(problemId, 'checker')!;
      if (updatedChecker.compiled_binary && fs.existsSync(updatedChecker.compiled_binary)) {
        const copyDest = checker.copy_path ? path.join(destDir, checker.copy_path) : path.join(destDir, 'check');
        fs.mkdirSync(path.dirname(copyDest), { recursive: true });
        if (type === 'linux') {
          fs.copyFileSync(updatedChecker.compiled_binary, copyDest);
        }
      }
    }
  }

  // Generate scripts if they don't exist
  generateScripts(destDir, problemId);
}

function copyAllFiles(sourceDir: string, destDir: string, type: PackageType): void {
  if (!fs.existsSync(sourceDir)) return;

  const skipForLinux = new Set(['.exe', '.bat']);
  const skipForStandard = new Set<string>();

  function copyRec(src: string, dst: string, relPath: string): void {
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
      // Skip workdir
      if (path.basename(src) === 'workdir') return;
      fs.mkdirSync(dst, { recursive: true });
      for (const e of fs.readdirSync(src)) {
        copyRec(path.join(src, e), path.join(dst, e), relPath ? `${relPath}/${e}` : e);
      }
    } else {
      const ext = path.extname(src).toLowerCase();
      if (type === 'linux' && skipForLinux.has(ext)) return;
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    }
  }

  copyRec(sourceDir, destDir, '');
}

function generateScripts(destDir: string, problemId: number): void {
  const scriptsDir = path.join(destDir, 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });

  const scriptNames = [
    'gen-input-via-stdout', 'gen-input-via-file', 'gen-input-via-files',
    'gen-answer', 'run-checker-tests', 'run-validator-tests',
  ];

  for (const name of scriptNames) {
    const sh = path.join(scriptsDir, `${name}.sh`);
    const bat = path.join(scriptsDir, `${name}.bat`);
    if (!fs.existsSync(sh)) {
      fs.writeFileSync(sh, `#!/bin/bash\n# ${name}\n`, 'utf-8');
    }
    if (!fs.existsSync(bat)) {
      fs.writeFileSync(bat, `@echo off\nREM ${name}\n`, 'utf-8');
    }
  }
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

  // Build statements list
  const statements = stmts.flatMap(s => {
    const texPath = `statements/${s.language}/problem.tex`;
    const htmlPath = `statements/.html/${s.language}/problem.html`;
    const pdfPath = `statements/.pdf/${s.language}/problem.pdf`;
    const entries = [];
    entries.push({ language: s.language, path: texPath, type: 'application/x-tex', charset: 'UTF-8', mathjax: 'true' });
    entries.push({ language: s.language, path: pdfPath, type: 'application/pdf' });
    return entries;
  });

  const tutorials = stmts.flatMap(s => {
    const texPath = `statements/${s.language}/tutorial.tex`;
    const pdfPath = `statements/.pdf/${s.language}/tutorial.pdf`;
    return [
      { language: s.language, path: texPath, type: 'application/x-tex', charset: 'UTF-8', mathjax: 'true' },
      { language: s.language, path: pdfPath, type: 'application/pdf' },
    ];
  });

  return {
    revision: String(problem.revision),
    shortName: problem.short_name,
    url: problem.polygon_url || undefined,
    names,
    statements,
    tutorials,
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
          testCount: 0,
          inputPathPattern: 'files/tests/checker-tests/%02d',
          outputPathPattern: 'files/tests/checker-tests/%02d.o',
          answerPathPattern: 'files/tests/checker-tests/%02d.a',
          tests: [],
        },
      } : undefined,
      validators: validator ? [{
        source: validator.source_path ? { path: validator.source_path, type: validator.source_type } : undefined,
        binary: validator.binary_path ? { path: validator.binary_path, type: validator.binary_type } : undefined,
        testset: {
          testCount: 0,
          inputPathPattern: 'files/tests/validator-tests/%02d',
          tests: [],
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
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const zipEntry = zipPath ? `${zipPath}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        addDir(fullPath, zipEntry);
      } else {
        zip.addFile(zipEntry, fs.readFileSync(fullPath));
      }
    }
  }

  addDir(sourceDir, '');
  zip.writeZip(outputPath);
}
