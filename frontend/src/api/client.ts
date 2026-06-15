const BASE = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') + '/api';

type Params = Record<string, string | number | boolean | undefined>;

async function request<T>(
  method: 'GET' | 'POST',
  endpoint: string,
  params?: Params,
  body?: Record<string, unknown> | FormData
): Promise<T> {
  const url = new URL(`${BASE}/${endpoint}`, window.location.origin);
  if (method === 'GET' && params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = {};
  let bodyData: BodyInit | undefined;

  if (body instanceof FormData) {
    bodyData = body;
  } else if (body) {
    headers['Content-Type'] = 'application/json';
    bodyData = JSON.stringify(body);
  }

  const res = await fetch(url.toString(), {
    method,
    credentials: 'include',
    headers,
    body: bodyData,
  });

  const json = await res.json();
  if (json.status === 'FAILED') {
    throw new ApiError(json.comment ?? 'Unknown error', res.status);
  }
  if (!res.ok) {
    // Fastify 500 errors: { statusCode, error, message }
    throw new ApiError(json.message ?? json.error ?? `HTTP ${res.status}`, res.status);
  }
  return json.result;
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export function get<T>(endpoint: string, params?: Params): Promise<T> {
  return request<T>('GET', endpoint, params);
}

export function post<T>(endpoint: string, body?: Record<string, unknown>): Promise<T> {
  return request<T>('POST', endpoint, undefined, body);
}

export function postForm<T>(endpoint: string, form: FormData): Promise<T> {
  return request<T>('POST', endpoint, undefined, form);
}

// Auth
export const auth = {
  login: (username: string, password: string) =>
    post<{ id: number; username: string; mustChangePassword: boolean }>('auth/login', { username, password }),
  logout: () => post<null>('auth/logout'),
  register: (username: string, password: string) =>
    post<{ id: number; username: string }>('auth/register', { username, password }),
  me: () => get<{ id: number; username: string; mustChangePassword: boolean; hasApiKey: boolean }>('auth/me'),
  changePassword: (currentPassword: string, newPassword: string) =>
    post<null>('auth/changePassword', { currentPassword, newPassword }),
  generateApiKey: () => post<{ apiKey: string; apiSecret: string }>('auth/generateApiKey'),
};

// Problems
export const problems = {
  list: () => get<ProblemSummary[]>('problems.list'),
  create: (name: string) => post<{ id: number; name: string }>('problem.create', { name }),
  delete: (problemId: number) => post<null>('problem.delete', { problemId }),
  clone: (problemId: number) => post<{ id: number; shortName: string }>('problem.clone', { problemId }),
  shares: (problemId: number) => get<{ id: number; username: string }[]>('problem.shares', { problemId }),
  share: (problemId: number, username: string) => post<{ id: number; username: string }[]>('problem.share', { problemId, username }),
  unshare: (problemId: number, username: string) => post<{ id: number; username: string }[]>('problem.unshare', { problemId, username }),
  info: (problemId: number) => get<ProblemInfo>('problem.info', { problemId }),
  updateInfo: (data: Record<string, unknown>) => post<null>('problem.updateInfo', data),
  statements: (problemId: number) => get<Statement[]>('problem.statements', { problemId }),
  saveStatement: (data: Record<string, unknown>) => post<null>('problem.saveStatement', data),
  renderStatements: (problemId: number, lang: string) =>
    get<{ html: string; tutorialHtml: string }>('problem.renderStatements', { problemId, lang }),
  compileStatement: (problemId: number, lang: string) =>
    post<{ ok: boolean; log: string }>('problem.compileStatement', { problemId, lang }),
  statementPdfUrl: (problemId: number, lang: string, download = false) =>
    `${BASE}/problem.statementPdf?problemId=${problemId}&lang=${encodeURIComponent(lang)}${download ? '&download=true' : ''}`,
  files: (problemId: number) => get<{ resources: ProblemFile[]; executables: Executable[] }>('problem.files', { problemId }),
  saveFile: (data: Record<string, unknown>) => post<null>('problem.saveFile', data),
  viewFile: (problemId: number, path: string) => `${BASE}/problem.viewFile?problemId=${problemId}&path=${encodeURIComponent(path)}`,
  solutions: (problemId: number) => get<Solution[]>('problem.solutions', { problemId }),
  saveSolution: (data: Record<string, unknown>) => post<{ id: number }>('problem.saveSolution', data),
  viewSolution: (problemId: number, solutionId: number) =>
    get<string>('problem.viewSolution', { problemId, solutionId }),
  deleteSolution: (data: Record<string, unknown>) => post<null>('problem.deleteSolution', data),
  downloadSolutionUrl: (problemId: number, solutionId: number) =>
    `${BASE}/problem.downloadSolution?problemId=${problemId}&solutionId=${solutionId}`,
  renameSolution: (data: Record<string, unknown>) => post<null>('problem.renameSolution', data),
  updateSolutionLang: (data: Record<string, unknown>) => post<null>('problem.updateSolutionLang', data),
  updateSolutionTag: (data: Record<string, unknown>) => post<null>('problem.updateSolutionTag', data),
  editSolution: (data: Record<string, unknown>) => post<null>('problem.editSolution', data),
  checker: (problemId: number) => get<Asset | null>('problem.checker', { problemId }),
  setChecker: (data: Record<string, unknown>) => post<null>('problem.setChecker', data),
  validator: (problemId: number) => get<Asset | null>('problem.validator', { problemId }),
  setValidator: (data: Record<string, unknown>) => post<null>('problem.setValidator', data),
  interactor: (problemId: number) => get<Asset | null>('problem.interactor', { problemId }),
  setInteractor: (data: Record<string, unknown>) => post<null>('problem.setInteractor', data),
  tests: (problemId: number, testset?: string) => get<TestEntry[]>('problem.tests', { problemId, testset }),
  saveTest: (data: Record<string, unknown>) => post<{ testIndex: number }>('problem.saveTest', data),
  deleteTest: (problemId: number, testIndex: number, testset?: string) =>
    post<null>('problem.deleteTest', { problemId, testIndex, testset }),
  testInput: (problemId: number, testIndex: number, testset?: string): string =>
    `${BASE}/problem.testInput?problemId=${problemId}&testIndex=${testIndex}${testset ? `&testset=${testset}` : ''}`,
  testAnswer: (problemId: number, testIndex: number, testset?: string): string =>
    `${BASE}/problem.testAnswer?problemId=${problemId}&testIndex=${testIndex}${testset ? `&testset=${testset}` : ''}`,
  generateAnswers: (problemId: number, testset?: string) =>
    post<{ started: boolean; alreadyRunning?: boolean; running: boolean; total: number; done: number; generated: number; errors: string[]; errorCount: number }>('problem.generateAnswers', { problemId, testset }),
  generateAnswersProgress: (problemId: number) =>
    get<{ running: boolean; total: number; done: number; generated: number; errors: string[]; errorCount: number }>('problem.generateAnswersProgress', { problemId }),
  updateTest: (problemId: number, testIndex: number, data: { sample?: boolean; group?: string; points?: number; description?: string }, testset?: string) =>
    post<null>('problem.updateTest', { problemId, testIndex, testset, ...Object.fromEntries(Object.entries({ sample: data.sample?.toString(), group: data.group, points: data.points?.toString(), description: data.description }).filter(([,v]) => v !== undefined)) }),
  moveTest: (problemId: number, testIndex: number, direction: 'up' | 'down', testset?: string) =>
    post<null>('problem.moveTest', { problemId, testIndex, direction, testset }),
  previewTests: (problemId: number, testset?: string) => get<TestPreview[]>('problem.previewTests', { problemId, testset }),
  viewTestGroup: (problemId: number, testset?: string) => get<TestGroup[]>('problem.viewTestGroup', { problemId, testset }),
  saveTestGroup: (data: Record<string, unknown>) => post<null>('problem.saveTestGroup', data),
  enableGroups: (data: Record<string, unknown>) => post<null>('problem.enableGroups', data),
  enablePoints: (data: Record<string, unknown>) => post<null>('problem.enablePoints', data),
  checkerTests: (problemId: number) => get<CheckerTest[]>('problem.checkerTests', { problemId }),
  saveCheckerTest: (data: Record<string, unknown>) => post<{ testIndex: number }>('problem.saveCheckerTest', data),
  validatorTests: (problemId: number) => get<ValidatorTest[]>('problem.validatorTests', { problemId }),
  saveValidatorTest: (data: Record<string, unknown>) => post<{ testIndex: number }>('problem.saveValidatorTest', data),
  tags: (problemId: number) => get<string[]>('problem.viewTags', { problemId }),
  saveTags: (problemId: number, tags: string[]) => post<null>('problem.saveTags', { problemId, tags: tags.join(',') }),
  cautions: (problemId: number) => get<{ cautions: string[]; aiTips: unknown[] }>('problem.cautions', { problemId }),
  packages: (problemId: number) => get<Package[]>('problem.packages', { problemId }),
  buildPackage: (problemId: number, type: string, comment?: string, verify?: boolean) =>
    post<{ packageId: number; state: string }>('problem.buildPackage', { problemId, type, comment, verify: verify ? 'true' : undefined }),
  packageDownloadUrl: (problemId: number, packageId: number): string =>
    `${BASE}/problem.package?problemId=${problemId}&packageId=${packageId}`,
  importPackage: (file: File, overwrite = false): Promise<ImportResult> => {
    const form = new FormData();
    form.append('file', file);
    return postForm<ImportResult>(`problem.importPackage?overwrite=${overwrite}`, form);
  },
  invocations: (problemId: number) => get<Invocation[]>('problem.invocations', { problemId }),
  runInvocation: (problemId: number, solutionIds?: number[], testset?: string) =>
    post<{ invocationId: number; state: string }>('problem.runInvocation', {
      problemId, solutionIds: solutionIds?.join(',') ?? '', testset: testset ?? 'tests',
    }),
  invocationResults: (problemId: number, invocationId: number) =>
    get<{ state: string; runs: InvocationRun[] }>('problem.invocationResults', { problemId, invocationId }),
  stresses: (problemId: number) => get<Stress[]>('problem.stresses', { problemId }),
  saveStress: (data: Record<string, unknown>) => post<{ id: number }>('problem.saveStress', data),
  generalDescription: (problemId: number) => get<string>('problem.viewGeneralDescription', { problemId }),
  generalTutorial: (problemId: number) => get<string>('problem.viewGeneralTutorial', { problemId }),
  commitChanges: (problemId: number) => post<null>('problem.commitChanges', { problemId }),
  rename: (problemId: number, newName: string) => post<null>('problem.rename', { problemId, newName }),
  deleteStatement: (problemId: number, lang: string) => post<null>('problem.deleteStatement', { problemId, lang }),
  moveTestsTo: (problemId: number, testIndices: number[], targetIdx: number, testset?: string) =>
    post<{ count: number }>('problem.moveTestsTo', { problemId, testIndices, targetIdx, testset }),
  validate: (problemId: number) => get<{ errors: string[]; warnings: string[] }>('problem.validate', { problemId }),
  verify: (problemId: number) => post<VerifyReport>('problem.verify', { problemId }),
  testScript: (problemId: number) => get<{ script: string }>('problem.testScript', { problemId }),
  saveTestScript: (problemId: number, script: string) => post<null>('problem.saveTestScript', { problemId, script }),
  expandTestScript: (problemId: number, script: string) =>
    post<{ lines: string[]; count: number }>('problem.expandTestScript', { problemId, script }),
  applyTestScript: (problemId: number, script: string, mode: 'append' | 'replace') =>
    post<{ count: number }>('problem.applyTestScript', { problemId, script, mode }),
  previewScriptLine: (problemId: number, line: string) =>
    post<{ preview: string; truncated: boolean; size: number }>('problem.previewScriptLine', { problemId, line }),
  statementResources: (problemId: number, lang: string) =>
    get<string[]>('problem.statementResources', { problemId, lang }),
  saveStatementResource: (problemId: number, lang: string, file: File): Promise<{ name: string }> => {
    const form = new FormData();
    form.append('problemId', String(problemId));
    form.append('lang', lang);
    form.append('file', file);
    return postForm<{ name: string }>('problem.saveStatementResource', form);
  },
};

export const polygon = {
  savedKey: () => get<{ hasKey: boolean; apiKey: string | null; apiSecret: string | null }>('polygon.savedKey'),
  saveKey: (apiKey: string, apiSecret: string) => post<null>('polygon.saveKey', { apiKey, apiSecret }),
  clearKey: () => post<null>('polygon.clearKey'),
  importProblem: (polygonProblemId: number, apiKey: string, apiSecret: string, remember: boolean) =>
    post<{ shortName: string; filesImported: number; testsImported: number; warnings: string[]; polygonProblemId: number; packageRevision: number }>('polygon.importProblem', { polygonProblemId, apiKey, apiSecret, remember }),
  pushProblem: (problemId: number, apiKey: string, apiSecret: string, remember: boolean) =>
    post<{ polygonProblemId: number; done: string[]; errors: string[] }>('polygon.pushProblem', { problemId, apiKey, apiSecret, remember }),
  createProblem: (localProblemId: number, name: string, apiKey: string, apiSecret: string, remember: boolean, pushAfter: boolean) =>
    post<{ polygonProblemId: number; polygonName: string; push: { done: string[]; errors: string[] } | null }>('polygon.createProblem', { localProblemId, name, apiKey, apiSecret, remember, pushAfter }),
  linkProblem: (problemId: number, polygonProblemId: number) =>
    post<{ polygonProblemId: number }>('polygon.linkProblem', { problemId, polygonProblemId }),
};

export interface Contest { id: number; owner_id: number; name: string; location: string; date: string; language: string; created_at: string; owner_username?: string; isOwner?: boolean; }
export interface ContestProblem { problemId: number; index: string; shortName: string; revision: number; }

export const contests = {
  list: () => get<Contest[]>('contest.list'),
  create: (name: string) => post<Contest>('contest.create', { name }),
  info: (contestId: number) => get<Contest & { problems: ContestProblem[] }>('contest.info', { contestId }),
  update: (contestId: number, fields: { name?: string; location?: string; date?: string; language?: string }) =>
    post<null>('contest.update', { contestId, ...fields }),
  delete: (contestId: number) => post<null>('contest.delete', { contestId }),
  problems: (contestId: number) => get<ContestProblem[]>('contest.problems', { contestId }),
  addProblem: (contestId: number, problemId: number) => post<ContestProblem[]>('contest.addProblem', { contestId, problemId }),
  removeProblem: (contestId: number, problemId: number) => post<ContestProblem[]>('contest.removeProblem', { contestId, problemId }),
  reorder: (contestId: number, problemIds: number[]) => post<ContestProblem[]>('contest.reorderProblems', { contestId, problemIds }),
  compile: (contestId: number, lang: string, kind: 'statements' | 'tutorials') =>
    post<{ ok: boolean; log: string }>('contest.compileStatements', { contestId, lang, kind }),
  shares: (contestId: number) => get<{ id: number; username: string }[]>('contest.shares', { contestId }),
  share: (contestId: number, username: string) => post<{ id: number; username: string }[]>('contest.share', { contestId, username }),
  unshare: (contestId: number, username: string) => post<{ id: number; username: string }[]>('contest.unshare', { contestId, username }),
  pdfUrl: (contestId: number, lang: string, kind: 'statements' | 'tutorials', download = false) =>
    `${BASE}/contest.statementsPdf?contestId=${contestId}&lang=${encodeURIComponent(lang)}&kind=${kind}${download ? '&download=true' : ''}`,
};

// Types
export interface VerifyStep { name: string; status: 'ok' | 'warn' | 'fail'; details?: string[]; }
export interface VerifyReport { ok: boolean; steps: VerifyStep[]; }

export interface ProblemSummary {
  id: number;
  shortName: string;
  revision: number;
  timeLimit: number;
  memoryLimit: number;
  inputFile: string;
  outputFile: string;
  interactive: boolean;
  modified: boolean;
  updatedAt: string;
  ownerUsername?: string;
  isOwner?: boolean;
}

export interface ProblemInfo extends ProblemSummary {
  runCount: number;
  cpuName: string;
  cpuSpeed: string;
  generalDescription: string;
  generalTutorial: string;
  polygonProblemId: number | null;
  names: { language: string; value: string }[];
  tags: string[];
  checker: { sourcePath: string; sourceType: string; name: string } | null;
  validator: { sourcePath: string; sourceType: string } | null;
  interactor: { sourcePath: string; sourceType: string } | null;
  solutionsCount: number;
  testsCount: number;
  statementsCount: number;
}

export interface Statement {
  id: number;
  problem_id: number;
  language: string;
  name: string;
  legend: string;
  input_section: string;
  output_section: string;
  scoring: string;
  interaction: string;
  notes: string;
  tutorial: string;
  charset: string;
  mathjax: number;
}

export interface ProblemFile {
  id: number;
  path: string;
  file_role: string;
  source_type: string;
}

export interface Executable {
  id: number;
  source_path: string;
  source_type: string;
  binary_path: string;
  binary_type: string;
}

export interface Asset {
  id: number;
  asset_type: string;
  name: string;
  source_path: string;
  source_type: string;
  binary_path: string;
  binary_type: string;
  copy_path: string;
  compiled_binary: string;
}

export interface Solution {
  id: number;
  problem_id: number;
  source_path: string;
  source_type: string;
  binary_path: string;
  tag: string;
  compiled_binary: string;
  size: number;
  modified: string;
  author: string;
}

export interface TestEntry {
  id: number;
  testset_id: number;
  idx: number;
  method: string;
  cmd: string;
  description: string;
  sample: number;
  group_name: string;
  points: number;
  inputAvailable: boolean;
}

export interface TestPreview extends TestEntry {
  answerAvailable: boolean;
  inputPreview: string;
  inputSize: number;
  answerSize: number;
}

export interface TestGroup {
  id: number;
  name: string;
  points: number;
  points_policy: string;
  feedback_policy: string;
  dependencies: string[];
}

export interface CheckerTest {
  id: number;
  idx: number;
  input: string;
  output_data: string;
  answer: string;
  expected_verdict: string;
  run_verdict: string;
  run_comment: string;
}

export interface ValidatorTest {
  id: number;
  idx: number;
  input: string;
  expected_verdict: string;
  run_verdict: string;
  run_comment: string;
}

export interface Package {
  id: number;
  revision: number;
  type: string;
  state: string;
  comment: string;
  created_at: string;
  file_path: string;
}

export interface Invocation {
  id: number;
  testset_name: string;
  state: string;
  created_at: string;
}

export interface InvocationRun {
  id: number;
  solution_id: number;
  test_idx: number;
  verdict: string;
  time_ms: number;
  memory_bytes: number;
  exit_code: number;
  stderr_preview: string;
  points: number;
}

export interface Stress {
  id: number;
  generator_cmd: string;
  solution_path: string;
  name: string;
}

export interface ImportResult {
  problemId: number;
  shortName: string;
  warnings: string[];
  errors: string[];
  filesImported: number;
  testsImported: number;
}
