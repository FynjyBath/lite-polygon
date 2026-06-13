// Typed model for Polygon problem.xml + raw unknown fields for round-trip fidelity

export interface ProblemXmlModel {
  revision: string;
  shortName: string;
  url?: string;
  // unknown attributes on <problem> element
  _extraAttrs?: Record<string, string>;

  names: NameEntry[];
  statements: StatementEntry[];
  tutorials: TutorialEntry[];
  judging: JudgingModel;
  files: FilesModel;
  assets: AssetsModel;
  properties: PropertyEntry[];
  stresses: StressesModel;
  tags: string[];

  // unknown top-level children preserved verbatim
  _unknownNodes?: UnknownXmlNode[];
}

export interface NameEntry {
  language: string;
  value: string;
}

export interface StatementEntry {
  language: string;
  path: string;
  type: string;
  charset?: string;
  mathjax?: string;
}

export interface TutorialEntry {
  language: string;
  path: string;
  type: string;
  charset?: string;
  mathjax?: string;
}

export interface JudgingModel {
  inputFile: string;
  outputFile: string;
  runCount: number;
  cpuName?: string;
  cpuSpeed?: string;
  _extraAttrs?: Record<string, string>;
  testsets: TestsetModel[];
}

export interface TestsetModel {
  name: string;
  timeLimit: number;
  memoryLimit: number;
  testCount: number;
  inputPathPattern: string;
  answerPathPattern: string;
  tests: TestEntry[];
  groups: TestGroupEntry[];
}

export interface TestEntry {
  method: 'manual' | 'generated';
  cmd?: string;
  description?: string;
  sample?: boolean;
  group?: string;
  points?: number;
  _extraAttrs?: Record<string, string>;
}

export interface TestGroupEntry {
  name: string;
  points?: number;
  pointsPolicy: string;
  feedbackPolicy: string;
  dependencies: string[];
  _extraAttrs?: Record<string, string>;
}

export interface FilesModel {
  resources: ResourceFile[];
  executables: ExecutableEntry[];
}

export interface ResourceFile {
  path: string;
  type?: string;
  forTypes?: string;
  stages?: string;
  assets?: string;
  main?: string;
  _extraAttrs?: Record<string, string>;
}

export interface ExecutableEntry {
  source?: { path: string; type: string };
  binary?: { path: string; type: string };
}

export interface AssetsModel {
  checker?: CheckerModel;
  validators: ValidatorModel[];
  interactor?: InteractorModel;
  solutions: SolutionEntry[];
}

export interface CheckerModel {
  name?: string;
  type?: string;
  source?: { path: string; type: string };
  binary?: { path: string; type: string };
  copy?: { path: string; type?: string };
  testset?: CheckerTestsetModel;
}

export interface CheckerTestsetModel {
  testCount: number;
  inputPathPattern: string;
  outputPathPattern: string;
  answerPathPattern: string;
  tests: CheckerTestEntry[];
}

export interface CheckerTestEntry {
  verdict?: string;
  _extraAttrs?: Record<string, string>;
}

export interface ValidatorModel {
  source?: { path: string; type: string };
  binary?: { path: string; type: string };
  testset?: ValidatorTestsetModel;
}

export interface ValidatorTestsetModel {
  testCount: number;
  inputPathPattern: string;
  tests: ValidatorTestEntry[];
}

export interface ValidatorTestEntry {
  verdict?: string;
  testset?: string;
  group?: string;
  _extraAttrs?: Record<string, string>;
}

export interface InteractorModel {
  source?: { path: string; type: string };
  binary?: { path: string; type: string };
  runs?: number[];
}

export interface SolutionEntry {
  tag: string;
  source?: { path: string; type: string };
  binary?: { path: string; type: string };
}

export interface PropertyEntry {
  name: string;
  value: string;
}

export interface StressesModel {
  stressCount: number;
  stressPathPattern: string;
  list: StressEntry[];
}

export interface StressEntry {
  _raw?: unknown;
}

export interface UnknownXmlNode {
  tagName: string;
  raw: unknown;
}
