import { XMLParser } from 'fast-xml-parser';
import type {
  ProblemXmlModel, NameEntry, StatementEntry, TutorialEntry,
  JudgingModel, TestsetModel, TestEntry, TestGroupEntry,
  FilesModel, ResourceFile, ExecutableEntry,
  AssetsModel, CheckerModel, CheckerTestsetModel, CheckerTestEntry,
  ValidatorModel, ValidatorTestsetModel, ValidatorTestEntry,
  InteractorModel, SolutionEntry, PropertyEntry, StressesModel
} from './types';

const PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
  cdataPropName: '__cdata',
  isArray: (tagName: string) => {
    const arrays = new Set([
      'name', 'statement', 'tutorial', 'testset', 'test', 'group',
      'dependency', 'file', 'executable', 'validator', 'solution',
      'property', 'tag', 'run', 'stress',
    ]);
    return arrays.has(tagName);
  },
};

function attr(obj: Record<string, unknown>, key: string, def = ''): string {
  return String((obj[`@_${key}`] ?? def));
}

function attrOpt(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[`@_${key}`];
  return v !== undefined ? String(v) : undefined;
}

function text(obj: unknown): string {
  if (obj == null) return '';
  if (typeof obj === 'string') return obj;
  if (typeof obj === 'object') {
    const o = obj as Record<string, unknown>;
    if (o.__cdata != null) return String(o.__cdata);
    if (o['#text'] != null) return String(o['#text']);
  }
  return String(obj);
}

function childAttrs(obj: Record<string, unknown>): Record<string, string> {
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('@_')) extra[k.slice(2)] = String(v);
  }
  return extra;
}

function knownKeys(keys: string[]): (k: string) => boolean {
  const s = new Set(keys);
  return (k) => s.has(k) || k.startsWith('@_');
}

export function parseProblemXml(xmlContent: string): ProblemXmlModel {
  const parser = new XMLParser(PARSER_OPTIONS);
  const raw = parser.parse(xmlContent) as Record<string, unknown>;
  const prob = (raw['problem'] ?? {}) as Record<string, unknown>;

  const revision = attr(prob, 'revision');
  const shortName = attr(prob, 'short-name');
  const url = attrOpt(prob, 'url');

  // Collect extra attrs on <problem>
  const knownProbAttrs = new Set(['revision', 'short-name', 'url']);
  const extraAttrs: Record<string, string> = {};
  for (const [k, v] of Object.entries(prob)) {
    if (k.startsWith('@_')) {
      const name = k.slice(2);
      if (!knownProbAttrs.has(name)) extraAttrs[name] = String(v);
    }
  }

  const names = parseNames(prob['names']);
  const statements = parseStatements(prob['statements']);
  const tutorials = parseTutorials(prob['tutorials']);
  const judging = parseJudging(prob['judging']);
  const files = parseFiles(prob['files']);
  const assets = parseAssets(prob['assets']);
  const properties = parseProperties(prob['properties']);
  const stresses = parseStresses(prob['stresses']);
  const tags = parseTags(prob['tags']);

  // Unknown top-level nodes
  const knownTopLevel = new Set([
    'names', 'statements', 'tutorials', 'judging', 'files',
    'assets', 'properties', 'stresses', 'tags',
  ]);
  const unknownNodes: Array<{ tagName: string; raw: unknown }> = [];
  for (const [k, v] of Object.entries(prob)) {
    if (!k.startsWith('@_') && !knownTopLevel.has(k)) {
      unknownNodes.push({ tagName: k, raw: v });
    }
  }

  return {
    revision, shortName, url,
    _extraAttrs: Object.keys(extraAttrs).length ? extraAttrs : undefined,
    names, statements, tutorials, judging, files, assets,
    properties, stresses, tags,
    _unknownNodes: unknownNodes.length ? unknownNodes : undefined,
  };
}

function parseNames(raw: unknown): NameEntry[] {
  if (!raw) return [];
  const r = raw as Record<string, unknown>;
  const nameArr = (r['name'] ?? []) as Record<string, unknown>[];
  return nameArr.map(n => ({
    language: attr(n, 'language'),
    value: attr(n, 'value'),
  }));
}

function parseStatements(raw: unknown): StatementEntry[] {
  if (!raw) return [];
  const r = raw as Record<string, unknown>;
  // statements may have a latex-pdf-mode attr we don't track separately
  const arr = (r['statement'] ?? []) as Record<string, unknown>[];
  return arr.map(s => ({
    language: attr(s, 'language'),
    path: attr(s, 'path'),
    type: attr(s, 'type'),
    charset: attrOpt(s, 'charset'),
    mathjax: attrOpt(s, 'mathjax'),
  }));
}

function parseTutorials(raw: unknown): TutorialEntry[] {
  if (!raw) return [];
  const r = raw as Record<string, unknown>;
  const arr = (r['tutorial'] ?? []) as Record<string, unknown>[];
  return arr.map(t => ({
    language: attr(t, 'language'),
    path: attr(t, 'path'),
    type: attr(t, 'type'),
    charset: attrOpt(t, 'charset'),
    mathjax: attrOpt(t, 'mathjax'),
  }));
}

function parseJudging(raw: unknown): JudgingModel {
  if (!raw) return { inputFile: '', outputFile: '', runCount: 1, testsets: [] };
  const r = raw as Record<string, unknown>;
  const extraAttrs: Record<string, string> = {};
  const knownJ = new Set(['input-file', 'output-file', 'run-count', 'cpu-name', 'cpu-speed']);
  for (const [k, v] of Object.entries(r)) {
    if (k.startsWith('@_') && !knownJ.has(k.slice(2))) extraAttrs[k.slice(2)] = String(v);
  }
  const testsets = ((r['testset'] ?? []) as Record<string, unknown>[]).map(parseTestset);
  return {
    inputFile: attr(r, 'input-file'),
    outputFile: attr(r, 'output-file'),
    runCount: parseInt(attr(r, 'run-count', '1')) || 1,
    cpuName: attrOpt(r, 'cpu-name'),
    cpuSpeed: attrOpt(r, 'cpu-speed'),
    _extraAttrs: Object.keys(extraAttrs).length ? extraAttrs : undefined,
    testsets,
  };
}

function parseTestset(raw: Record<string, unknown>): TestsetModel {
  const name = attr(raw, 'name', 'tests');
  const timeLimit = parseInt(text(raw['time-limit'])) || 1000;
  const memoryLimit = parseInt(text(raw['memory-limit'])) || 268435456;
  const testCount = parseInt(text(raw['test-count'])) || 0;
  const inputPathPattern = text(raw['input-path-pattern']) || 'tests/%02d';
  const answerPathPattern = text(raw['answer-path-pattern']) || 'tests/%02d.a';

  const testsEl = (raw['tests'] ?? {}) as Record<string, unknown>;
  const testArr = (testsEl['test'] ?? []) as Record<string, unknown>[];
  const tests: TestEntry[] = testArr.map(t => {
    const method = attr(t, 'method', 'manual') as 'manual' | 'generated';
    const cmd = attrOpt(t, 'cmd');
    const desc = attrOpt(t, 'description');
    const sample = attrOpt(t, 'sample') === 'true';
    const group = attrOpt(t, 'group');
    const pts = attrOpt(t, 'points');
    const extraAttrs: Record<string, string> = {};
    const knownT = new Set(['method', 'cmd', 'description', 'sample', 'group', 'points']);
    for (const [k, v] of Object.entries(t)) {
      if (k.startsWith('@_') && !knownT.has(k.slice(2))) extraAttrs[k.slice(2)] = String(v);
    }
    return {
      method,
      cmd: cmd || undefined,
      description: desc || undefined,
      sample: sample || undefined,
      group: group || undefined,
      points: pts !== undefined ? parseFloat(pts) : undefined,
      _extraAttrs: Object.keys(extraAttrs).length ? extraAttrs : undefined,
    };
  });

  const groupsEl = (raw['groups'] ?? {}) as Record<string, unknown>;
  const groupArr = (groupsEl['group'] ?? []) as Record<string, unknown>[];
  const groups: TestGroupEntry[] = groupArr.map(g => {
    const deps = ((g['dependencies'] as Record<string, unknown> | undefined)?.['dependency'] ?? []) as Record<string, unknown>[];
    const extraAttrs: Record<string, string> = {};
    const knownG = new Set(['name', 'points', 'points-policy', 'feedback-policy']);
    for (const [k, v] of Object.entries(g)) {
      if (k.startsWith('@_') && !knownG.has(k.slice(2))) extraAttrs[k.slice(2)] = String(v);
    }
    return {
      name: attr(g, 'name'),
      points: attrOpt(g, 'points') !== undefined ? parseFloat(attr(g, 'points')) : undefined,
      pointsPolicy: attr(g, 'points-policy', 'each-test'),
      feedbackPolicy: attr(g, 'feedback-policy', 'complete'),
      dependencies: deps.map(d => attr(d, 'group')),
      _extraAttrs: Object.keys(extraAttrs).length ? extraAttrs : undefined,
    };
  });

  return { name, timeLimit, memoryLimit, testCount, inputPathPattern, answerPathPattern, tests, groups };
}

function parseFiles(raw: unknown): FilesModel {
  if (!raw) return { resources: [], executables: [] };
  const r = raw as Record<string, unknown>;
  const resEl = (r['resources'] ?? {}) as Record<string, unknown>;
  const fileArr = (resEl['file'] ?? []) as Record<string, unknown>[];
  const resources: ResourceFile[] = fileArr.map(f => {
    const extraAttrs: Record<string, string> = {};
    const knownF = new Set(['path', 'type', 'for-types', 'stages', 'assets', 'main']);
    for (const [k, v] of Object.entries(f)) {
      if (k.startsWith('@_') && !knownF.has(k.slice(2))) extraAttrs[k.slice(2)] = String(v);
    }
    return {
      path: attr(f, 'path'),
      type: attrOpt(f, 'type'),
      forTypes: attrOpt(f, 'for-types'),
      stages: attrOpt(f, 'stages'),
      assets: attrOpt(f, 'assets'),
      main: attrOpt(f, 'main'),
      _extraAttrs: Object.keys(extraAttrs).length ? extraAttrs : undefined,
    };
  });

  const execEl = (r['executables'] ?? {}) as Record<string, unknown>;
  const execArr = (execEl['executable'] ?? []) as Record<string, unknown>[];
  const executables: ExecutableEntry[] = execArr.map(e => {
    const src = e['source'] as Record<string, unknown> | undefined;
    const bin = e['binary'] as Record<string, unknown> | undefined;
    return {
      source: src ? { path: attr(src, 'path'), type: attr(src, 'type') } : undefined,
      binary: bin ? { path: attr(bin, 'path'), type: attr(bin, 'type') } : undefined,
    };
  });

  return { resources, executables };
}

function parseAssets(raw: unknown): AssetsModel {
  if (!raw) return { validators: [], solutions: [] };
  const r = raw as Record<string, unknown>;

  const checker = parseChecker(r['checker']);
  const validators = parseValidators(r['validators']);
  const interactor = parseInteractor(r['interactor']);
  const solutions = parseSolutions(r['solutions']);

  return { checker, validators, interactor, solutions };
}

function unwrapEl(v: unknown): Record<string, unknown> | undefined {
  if (!v) return undefined;
  if (Array.isArray(v)) return v[0] as Record<string, unknown>;
  return v as Record<string, unknown>;
}

function parseChecker(raw: unknown): CheckerModel | undefined {
  if (!raw) return undefined;
  const r = raw as Record<string, unknown>;
  const src = r['source'] as Record<string, unknown> | undefined;
  const bin = r['binary'] as Record<string, unknown> | undefined;
  const copy = r['copy'] as Record<string, unknown> | undefined;
  const testsetEl = unwrapEl(r['testset']);

  let testset: CheckerTestsetModel | undefined;
  if (testsetEl) {
    const testsEl = (testsetEl['tests'] ?? {}) as Record<string, unknown>;
    const testArr = (testsEl['test'] ?? []) as Record<string, unknown>[];
    const tests: CheckerTestEntry[] = testArr.map(t => ({
      verdict: attrOpt(t, 'verdict'),
    }));
    testset = {
      testCount: parseInt(text(testsetEl['test-count'])) || 0,
      inputPathPattern: text(testsetEl['input-path-pattern']),
      outputPathPattern: text(testsetEl['output-path-pattern']),
      answerPathPattern: text(testsetEl['answer-path-pattern']),
      tests,
    };
  }

  return {
    name: attrOpt(r, 'name'),
    type: attrOpt(r, 'type'),
    source: src ? { path: attr(src, 'path'), type: attr(src, 'type') } : undefined,
    binary: bin ? { path: attr(bin, 'path'), type: attr(bin, 'type') } : undefined,
    copy: copy ? { path: attr(copy, 'path'), type: attrOpt(copy, 'type') } : undefined,
    testset,
  };
}

function parseValidators(raw: unknown): ValidatorModel[] {
  if (!raw) return [];
  const r = raw as Record<string, unknown>;
  const arr = (r['validator'] ?? []) as Record<string, unknown>[];
  return arr.map(v => {
    const src = v['source'] as Record<string, unknown> | undefined;
    const bin = v['binary'] as Record<string, unknown> | undefined;
    const tsEl = unwrapEl(v['testset']);
    let testset: ValidatorTestsetModel | undefined;
    if (tsEl) {
      const testsEl = (tsEl['tests'] ?? {}) as Record<string, unknown>;
      const testArr = (testsEl['test'] ?? []) as Record<string, unknown>[];
      const tests: ValidatorTestEntry[] = testArr.map(t => ({
        verdict: attrOpt(t, 'verdict'),
        testset: attrOpt(t, 'testset'),
        group: attrOpt(t, 'group'),
      }));
      testset = {
        testCount: parseInt(text(tsEl['test-count'])) || 0,
        inputPathPattern: text(tsEl['input-path-pattern']) || 'files/tests/validator-tests/%02d',
        tests,
      };
    }
    return {
      source: src ? { path: attr(src, 'path'), type: attr(src, 'type') } : undefined,
      binary: bin ? { path: attr(bin, 'path'), type: attr(bin, 'type') } : undefined,
      testset,
    };
  });
}

function parseInteractor(raw: unknown): InteractorModel | undefined {
  if (!raw) return undefined;
  const r = raw as Record<string, unknown>;
  const src = r['source'] as Record<string, unknown> | undefined;
  const bin = r['binary'] as Record<string, unknown> | undefined;
  const runsEl = r['runs'] as Record<string, unknown> | undefined;
  let runs: number[] | undefined;
  if (runsEl) {
    const runArr = (runsEl['run'] ?? []) as unknown[];
    runs = runArr.map(x => parseInt(text(x)));
  }
  return {
    source: src ? { path: attr(src, 'path'), type: attr(src, 'type') } : undefined,
    binary: bin ? { path: attr(bin, 'path'), type: attr(bin, 'type') } : undefined,
    runs,
  };
}

function parseSolutions(raw: unknown): SolutionEntry[] {
  if (!raw) return [];
  const r = raw as Record<string, unknown>;
  const arr = (r['solution'] ?? []) as Record<string, unknown>[];
  return arr.map(s => {
    const src = s['source'] as Record<string, unknown> | undefined;
    const bin = s['binary'] as Record<string, unknown> | undefined;
    return {
      tag: attr(s, 'tag'),
      source: src ? { path: attr(src, 'path'), type: attr(src, 'type') } : undefined,
      binary: bin ? { path: attr(bin, 'path'), type: attr(bin, 'type') } : undefined,
    };
  });
}

function parseProperties(raw: unknown): PropertyEntry[] {
  if (!raw) return [];
  const r = raw as Record<string, unknown>;
  const arr = (r['property'] ?? []) as Record<string, unknown>[];
  return arr.map(p => ({
    name: attr(p, 'name'),
    value: attr(p, 'value'),
  }));
}

function parseStresses(raw: unknown): StressesModel {
  if (!raw) return { stressCount: 0, stressPathPattern: 'stresses/%03d', list: [] };
  const r = raw as Record<string, unknown>;
  const stressCount = parseInt(text(r['stress-count'])) || 0;
  const stressPathPattern = text(r['stress-path-pattern']) || 'stresses/%03d';
  const listEl = r['list'] as Record<string, unknown> | undefined;
  const list = listEl ? (((listEl['stress'] ?? []) as unknown[]).map(s => ({ _raw: s }))) : [];
  return { stressCount, stressPathPattern, list };
}

function parseTags(raw: unknown): string[] {
  if (!raw) return [];
  const r = raw as Record<string, unknown>;
  const arr = (r['tag'] ?? []) as Record<string, unknown>[];
  return arr.map(t => attr(t, 'value'));
}
