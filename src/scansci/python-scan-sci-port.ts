import {
  SCANSCI_SCHEMA_VERSION,
  SCANSCI_SOURCE_RULES_VERSION,
  type OnePaperDownloadRequest,
  type OnePaperDownloadResult,
  type ScanSciArchitecture,
  type ScanSciCapability,
  type ScanSciDependency,
  type ScanSciInstallPlan,
  type ScanSciPort,
  type ScanSciRuntimeCandidate,
  type ScanSciRuntimePreparation,
  type VisibleLoginResult,
} from "./scan-sci-port";

const CAPABILITY_TIMEOUT_MILLISECONDS = 10_000;
const DISCOVERY_TIMEOUT_MILLISECONDS = 5_000;
const MINIMUM_PYTHON_VERSION = [3, 11] as const;
const DEFAULT_DOWNLOAD_TIMEOUT_MILLISECONDS = 120_000;
const INSTALL_TIMEOUT_MILLISECONDS = 300_000;
const PACKAGE_INDEX = "https://pypi.tuna.tsinghua.edu.cn/simple" as const;
const MAX_DIAGNOSTIC_CHARACTERS = 1_024;
const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PROXY_ENVIRONMENT_VARIABLES = [
  "ALL_PROXY",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "all_proxy",
  "https_proxy",
  "http_proxy",
  "no_proxy",
  "PIP_CONFIG_FILE",
  "PIP_EXTRA_INDEX_URL",
  "PIP_INDEX_URL",
  "PIP_TRUSTED_HOST",
  "PIP_CERT",
  "PIP_CLIENT_CERT",
  "PIP_PROXY",
  "REQUESTS_CA_BUNDLE",
  "CURL_CA_BUNDLE",
  "SSL_CERT_FILE",
  "SCANSCI_PDF_PROXY",
  "CLOAKBROWSER_LICENSE_KEY",
  "CLOAKBROWSER_BINARY_PATH",
  "CLOAKBROWSER_DOWNLOAD_URL",
] as const;
const FORCED_POLICY = {
  strategy: "legal_only",
  scihubEnabled: false,
  useTor: false,
  useVpnsci: false,
} as const;
const LOCKED_DEPENDENCIES = [
  ["requests", "requests", "2.34.2"],
  ["certifi", "certifi", "2026.7.22"],
  ["charset-normalizer", "charset_normalizer", "3.4.9"],
  ["idna", "idna", "3.18"],
  ["urllib3", "urllib3", "2.7.0"],
] as const;
const LOCKED_PACKAGE_HASHES = [
  ["2a0d60c172f83ac6ab31e4554906c0f3b3588d37b5cb939b1c061f4907e278e0"],
  ["62f22742b58a1a33014a2b6b706588a8d7e2a88ae7bd1a6ebe8c992928483775"],
  [
    "6366a16e1a25018694d6a5d784d09b046edc9eac40ea2b54065c3052672516a1",
    "1d22856ffbe153a602df38e4a5464f0b748a54002e0d69ac6d2ad0a197cc99ec",
    "4b3dac63058cc36820b0dd072f89898604e2d39686fe05321729d00d8ac185a0",
    "78fa18e436a1a0e58dbd7e02fc4473f3f32cceb12df9dfca542d075961c307d2",
    "fe2c7201c642b7c308f1675355ad7ff7b66acfe3541625efe5a3ad38f29d6115",
    "611057cc5d5c0afc743ba8be6bd828c17e0aaa8643f9d0a9b9bb7dea80eb8012",
    "16b65ea0f2465b6fb52aa22de5eca612aa964ddfec00a912e26f4656cbef890b",
    "40a126142a56b2dfc0aacbad1de8310cbf60da7656db0e6b16eebd48e3e93519",
    "9b8e0f3107e2200b76f6054de99016eac3ee6762713587b36baaa7e4bd2ae177",
    "19ac87f93086ce37b86e098888555c4b4bc48102279bae3350098c0ed664b501",
    "68e5f26a1ad57ded6d1cfb85331d1c1a195314756471d97758c48498bb4dcdf5",
  ],
  ["7f952cbe720b688055e3f87de14f5c3e5fdaa8bc3928985c4077ca689de849a2"],
  ["9fb4c81ebbb1ce9531cce37674bbc6f1360472bc18ca9a553ede278ef7276897"],
] as const;
const CAPABILITY_PROBE_SCRIPT = `
import importlib, importlib.metadata, json, platform, sys
sys.dont_write_bytecode = True
locked = ${JSON.stringify(LOCKED_DEPENDENCIES)}
dependencies = []
for distribution, import_name, expected in locked:
    try:
        installed = importlib.metadata.version(distribution)
        status = "available" if installed == expected else "incompatible"
        if status == "available":
            try:
                importlib.import_module(import_name)
            except Exception:
                status = "incompatible"
        item = {"name": distribution, "requirement": "==" + expected, "installedVersion": installed, "status": status}
    except importlib.metadata.PackageNotFoundError:
        item = {"name": distribution, "requirement": "==" + expected, "status": "missing"}
    dependencies.append(item)
machine = platform.machine().lower()
architecture = "x64" if machine in ("amd64", "x86_64") else "arm64" if machine in ("arm64", "aarch64") else "x86" if machine in ("x86", "i386", "i686") else machine
available = sys.version_info >= (3, 11) and all(item["status"] == "available" for item in dependencies)
result = {"executable": str(__import__("pathlib").Path(sys.executable).resolve()), "pythonVersion": platform.python_version(), "architecture": architecture, "moduleVersion": "3.0.0", "dependencies": dependencies, "features": {"onePaperDownload": "available" if available else "unavailable", "visibleLogin": "disabled"}}
print(json.dumps({"schemaVersion": 3, "sourceRulesVersion": 3, "operation": "probe", "ok": True, "result": result}, separators=(",", ":")))
`.trim();

export type PythonProcessRequest = Readonly<{
  command: string;
  arguments: readonly string[];
  stdin: string;
  timeoutMilliseconds: number;
  removeEnvironment: readonly string[];
  workingDirectory?: string;
  signal?: AbortSignal;
}>;

export type PythonProcessResult = Readonly<{
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}>;

export interface PythonScanSciFileSystem {
  pathExists(path: string): Promise<boolean>;
  canonicalizeExisting(path: string): Promise<string>;
  createDirectory(path: string): Promise<void>;
  createDirectoryExclusive(path: string): Promise<void>;
  readText(path: string): Promise<string>;
  copyExclusiveContained(
    sourcePath: string,
    destinationRoot: string,
    destinationPath: string,
  ): Promise<void>;
  removeDirectory(path: string): Promise<void>;
}

export interface PythonScanSciRuntime {
  runProcess(request: PythonProcessRequest): Promise<PythonProcessResult>;
  ensureModuleAssets(): Promise<void>;
  files: PythonScanSciFileSystem;
  nextRequestID(): string;
}

export type PythonScanSciOptions = Readonly<{
  moduleRoot: string;
  privateRuntimeRoot: string;
  hostArchitecture: ScanSciArchitecture;
}>;

export function createPythonScanSciPort(
  runtime: PythonScanSciRuntime,
  options: PythonScanSciOptions,
): ScanSciPort {
  return new PythonScanSciPort(runtime, options);
}

class PythonScanSciPort implements ScanSciPort {
  private activeExecutable: string | undefined;

  constructor(
    private readonly runtime: PythonScanSciRuntime,
    private readonly options: PythonScanSciOptions,
  ) {}

  async prepareRuntime(request: {
    allowInstall: boolean;
    executableOverride?: string;
    signal?: AbortSignal;
  }): Promise<ScanSciRuntimePreparation> {
    throwIfAborted(request.signal);
    const optionError = this.optionError();
    if (optionError) {
      return {
        status: "unavailable",
        error: optionError,
        candidates: [],
      };
    }
    const executable = request.executableOverride;
    if (executable && !isAbsoluteWindowsPath(executable)) {
      return {
        status: "unavailable",
        error: "Configured Python executable must be an absolute Windows path",
        candidates: [],
      };
    }

    const privateEnvironment = this.privateEnvironmentPath();
    const privateEnvironmentExists =
      await this.runtime.files.pathExists(privateEnvironment);
    const privateExecutable = this.privateEnvironmentExecutable();
    if (await this.runtime.files.pathExists(privateExecutable)) {
      const privateCandidate = await this.probeExecutable(
        privateExecutable,
        request.signal,
      );
      const prepared = await this.prepareFromCandidates(
        [privateCandidate],
        false,
        "private environment",
      );
      if (prepared.status === "ready") return prepared;
    }

    if (request.allowInstall && executable) {
      return this.prepareFromCandidates(
        [await this.probeExecutable(executable, request.signal)],
        true,
        "configured override",
        privateEnvironmentExists,
        request.signal,
      );
    }

    const candidates = await this.probeDiscoveredCandidates(request.signal);
    const automatic = await this.prepareFromCandidates(
      candidates,
      request.allowInstall,
      "automatic detection",
      privateEnvironmentExists,
      request.signal,
    );
    if (automatic.status !== "unavailable" || !executable) return automatic;
    return this.prepareFromCandidates(
      [await this.probeExecutable(executable, request.signal)],
      request.allowInstall,
      "configured override",
      privateEnvironmentExists,
      request.signal,
    );
  }

  async startVisibleLogin(request: {
    userInitiated: true;
    routeID: string;
  }): Promise<VisibleLoginResult> {
    if (request.userInitiated !== true) {
      return {
        status: "failed",
        error: "Visible login must be initiated by an explicit user action",
      };
    }
    const optionError = this.optionError();
    if (optionError) return { status: "failed", error: optionError };
    let rules: SourceRules;
    try {
      await this.runtime.ensureModuleAssets();
      rules = await this.loadSourceRules();
    } catch (error) {
      return { status: "failed", error: originalError(error) };
    }
    const route = rules.routes.find(
      (candidate) => candidate.id === request.routeID,
    );
    if (!route || route.kind !== "institution") {
      return {
        status: "failed",
        error: `Unknown institution route: ${request.routeID}`,
      };
    }
    if (!route.enabled) {
      return {
        status: "failed",
        error:
          route.disabledReason ?? `Institution route ${route.id} is disabled`,
      };
    }
    return {
      status: "failed",
      error: `Institution route ${route.id} has no accepted runtime implementation`,
    };
  }

  async downloadOnePaper(
    request: OnePaperDownloadRequest,
  ): Promise<OnePaperDownloadResult> {
    let requestDirectory: string | undefined;
    let requestDirectoryOwned = false;
    let canonicalOwnedRequestDirectory: string | undefined;
    let committedPath: string | undefined;
    let outcome: OnePaperDownloadResult;
    try {
      const paths = await this.resolveDownloadPaths(request);
      const preparation = this.activeExecutable
        ? undefined
        : await this.prepareRuntime({ allowInstall: false });
      if (preparation && preparation.status !== "ready") {
        throw new Error(
          preparation.status === "needs-install"
            ? "ScanSci runtime dependencies require confirmed installation"
            : preparation.error,
        );
      }
      const executable =
        this.activeExecutable ??
        (preparation?.status === "ready"
          ? preparation.capability.executable
          : undefined);
      if (!executable) throw new Error("ScanSci runtime is not ready");
      const timeoutMilliseconds =
        request.timeoutMilliseconds ?? DEFAULT_DOWNLOAD_TIMEOUT_MILLISECONDS;
      if (!Number.isFinite(timeoutMilliseconds) || timeoutMilliseconds <= 0) {
        throw new Error("ScanSci download timeout must be positive");
      }
      await this.runtime.ensureModuleAssets();
      const rules = await this.loadSourceRules();
      const requestID = this.runtime.nextRequestID();
      if (!REQUEST_ID_PATTERN.test(requestID)) {
        throw new Error("ScanSci request id is invalid");
      }
      const cacheRoot = joinWindows(paths.destination, "ScanSciCache");
      requestDirectory = joinWindows(cacheRoot, requestID);
      await this.runtime.files.createDirectory(cacheRoot);
      await this.runtime.files.createDirectoryExclusive(requestDirectory);
      requestDirectoryOwned = true;
      const canonicalRequestDirectory =
        await this.runtime.files.canonicalizeExisting(requestDirectory);
      if (!sameWindowsPath(canonicalRequestDirectory, requestDirectory)) {
        throw new Error(
          "ScanSci request directory canonicalization changed its path",
        );
      }
      canonicalOwnedRequestDirectory = canonicalRequestDirectory;

      const process = await this.runtime.runProcess({
        command: executable,
        arguments: [
          "-E",
          "-s",
          joinWindows(this.options.moduleRoot, "bridge.py"),
        ],
        stdin: `${JSON.stringify(
          protocolRequest("download-one", {
            paper: protocolPaper(request.paper),
            outputDirectory: requestDirectory,
            policy: FORCED_POLICY,
          }),
        )}\n`,
        timeoutMilliseconds,
        removeEnvironment: PROXY_ENVIRONMENT_VARIABLES,
        workingDirectory: requestDirectory,
      });
      if (process.timedOut) throw new Error("ScanSci download timed out");
      if (process.exitCode !== 0) {
        const diagnostic = sanitizeDiagnostic(process.stderr);
        throw new Error(
          `ScanSci Python process failed with exit code ${process.exitCode}${
            diagnostic ? `: ${diagnostic}` : ""
          }`,
        );
      }
      const response = parseProtocolResponse(process.stdout, "download-one");
      const result = parseDownloadResult(response.result);
      validateLegalSource(result.source, rules);
      const canonicalOutput = await this.runtime.files.canonicalizeExisting(
        result.outputPath,
      );
      if (!isContainedWindowsPath(canonicalRequestDirectory, canonicalOutput)) {
        throw new Error("ScanSci output escaped its request directory");
      }
      await this.runtime.files.copyExclusiveContained(
        canonicalOutput,
        paths.destination,
        paths.finalTarget,
      );
      committedPath = paths.finalTarget;
      outcome = { status: "downloaded", savedPath: committedPath };
    } catch (error) {
      outcome = { status: "failed", error: originalError(error) };
    }
    if (requestDirectory && requestDirectoryOwned) {
      try {
        const cleanupPath =
          await this.runtime.files.canonicalizeExisting(requestDirectory);
        if (
          !canonicalOwnedRequestDirectory ||
          !sameWindowsPath(cleanupPath, canonicalOwnedRequestDirectory)
        ) {
          throw new Error("owned request directory changed before cleanup");
        }
        await this.runtime.files.removeDirectory(cleanupPath);
      } catch (error) {
        const cleanupError = `ScanSci request cleanup failed: ${originalError(error)}`;
        if (committedPath) {
          return {
            status: "downloaded",
            savedPath: committedPath,
            cleanupWarning: cleanupError,
          };
        }
        return {
          status: "failed",
          error: cleanupError,
        };
      }
    }
    return outcome;
  }

  private async probeDiscoveredCandidates(
    signal?: AbortSignal,
  ): Promise<readonly ProbedCandidate[]> {
    const discovery = await this.discoverPythonCommands(signal);
    const candidates: ProbedCandidate[] = discovery.launcherFailure
      ? [
          {
            status: "failed",
            executable: "py launcher",
            error: discovery.launcherFailure,
          },
        ]
      : [];
    for (const command of discovery.commands) {
      throwIfAborted(signal);
      candidates.push(await this.probeExecutable(command, signal));
    }
    return candidates;
  }

  private async prepareFromCandidates(
    candidates: readonly ProbedCandidate[],
    allowInstall: boolean,
    selectionReason:
      "configured override" | "automatic detection" | "private environment",
    replacePrivateEnvironment = false,
    signal?: AbortSignal,
  ): Promise<ScanSciRuntimePreparation> {
    const compatible = candidates
      .filter(
        (
          candidate,
        ): candidate is Readonly<{
          status: "probed";
          result: ParsedCapabilityResult;
        }> =>
          candidate.status === "probed" &&
          !candidateIncompatibility(
            candidate.result,
            this.options.hostArchitecture,
          ),
      )
      .map((candidate) => candidate.result)
      .sort(compareCapabilityCandidates);
    const selected = compatible[0];
    if (selected) {
      const capability = availableCapability(selected, selectionReason);
      this.activeExecutable = capability.executable;
      return { status: "ready", capability };
    }

    const reportedCandidates = reportCandidates(candidates);
    const installBase = candidates
      .filter(
        (
          candidate,
        ): candidate is Readonly<{
          status: "probed";
          result: ParsedCapabilityResult;
        }> =>
          candidate.status === "probed" &&
          !candidateBaseIncompatibility(
            candidate.result,
            this.options.hostArchitecture,
          ) &&
          candidate.result.dependencies.some(
            (dependency) => dependency.status !== "available",
          ),
      )
      .map((candidate) => candidate.result)
      .sort(compareInstallCandidates)[0];
    if (!installBase) {
      return {
        status: "unavailable",
        error:
          "No compatible Python >=3.11 with the required architecture was found",
        candidates: reportedCandidates,
      };
    }

    const plan = this.installPlan(installBase);
    if (!allowInstall) {
      return {
        status: "needs-install",
        plan,
        candidates: reportedCandidates,
      };
    }
    return this.installPrivateEnvironment(
      installBase,
      plan,
      reportedCandidates,
      replacePrivateEnvironment,
      signal,
    );
  }

  private installPlan(candidate: ParsedCapabilityResult): ScanSciInstallPlan {
    return {
      baseExecutable: candidate.executable,
      privateEnvironment: joinWindows(this.options.privateRuntimeRoot, "venv"),
      packageIndex: PACKAGE_INDEX,
      requirementsLock: joinWindows(
        this.options.moduleRoot,
        "requirements.lock",
      ),
      dependencies: candidate.dependencies,
      packages: LOCKED_DEPENDENCIES.map((dependency, index) => ({
        name: dependency[0],
        version: dependency[2],
        sha256: [...(LOCKED_PACKAGE_HASHES[index] ?? [])],
      })),
      actions: [
        `Create a private virtual environment with ${candidate.executable}`,
        `Install the complete hash-locked package set from ${PACKAGE_INDEX}`,
        "Leave the selected base Python and all global pip configuration unchanged",
      ],
      cancelResult:
        "No environment is created or changed; downloads that require Python remain unavailable",
    };
  }

  private async installPrivateEnvironment(
    candidate: ParsedCapabilityResult,
    plan: ScanSciInstallPlan,
    candidates: readonly ScanSciRuntimeCandidate[],
    replacePrivateEnvironment: boolean,
    signal?: AbortSignal,
  ): Promise<ScanSciRuntimePreparation> {
    let ownsEnvironment = false;
    try {
      await this.runtime.ensureModuleAssets();
      throwIfAborted(signal);
      validateRequirementsLock(
        plan.packages,
        await this.runtime.files.readText(plan.requirementsLock),
      );
      await this.runtime.files.createDirectory(this.options.privateRuntimeRoot);
      if (
        replacePrivateEnvironment &&
        (await this.runtime.files.pathExists(plan.privateEnvironment))
      ) {
        await this.runtime.files.removeDirectory(plan.privateEnvironment);
      }
      await this.runtime.files.createDirectoryExclusive(
        plan.privateEnvironment,
      );
      ownsEnvironment = true;
      await this.runInstallProcess(
        candidate.executable,
        ["-E", "-s", "-m", "venv", plan.privateEnvironment],
        this.options.privateRuntimeRoot,
        signal,
      );
      await this.runInstallProcess(
        this.privateEnvironmentExecutable(),
        [
          "-E",
          "-s",
          "-m",
          "pip",
          "--isolated",
          "--disable-pip-version-check",
          "install",
          "--no-input",
          "--index-url",
          PACKAGE_INDEX,
          "--require-hashes",
          "--only-binary=:all:",
          "-r",
          plan.requirementsLock,
        ],
        plan.privateEnvironment,
        signal,
      );
      const installed = await this.probeExecutable(
        this.privateEnvironmentExecutable(),
        signal,
      );
      if (
        installed.status !== "probed" ||
        candidateIncompatibility(
          installed.result,
          this.options.hostArchitecture,
        )
      ) {
        throw new Error(
          installed.status === "failed"
            ? installed.error
            : "Installed private Python environment is incompatible",
        );
      }
      const capability = availableCapability(
        installed.result,
        "private environment",
      );
      this.activeExecutable = capability.executable;
      return { status: "ready", capability };
    } catch (error) {
      let cleanup = "";
      if (ownsEnvironment) {
        try {
          await this.runtime.files.removeDirectory(plan.privateEnvironment);
        } catch (cleanupError) {
          cleanup = `; private environment cleanup failed: ${originalError(cleanupError)}`;
        }
      }
      return {
        status: "unavailable",
        error: `ScanSci private environment installation failed; interpreter=${candidate.executable}; privateEnvironment=${plan.privateEnvironment}; packageIndex=${plan.packageIndex}: ${originalError(error)}${cleanup}`,
        candidates,
      };
    }
  }

  private async runInstallProcess(
    command: string,
    processArguments: readonly string[],
    workingDirectory: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const result = await this.runtime.runProcess({
      command,
      arguments: processArguments,
      stdin: "",
      timeoutMilliseconds: INSTALL_TIMEOUT_MILLISECONDS,
      removeEnvironment: PROXY_ENVIRONMENT_VARIABLES,
      workingDirectory,
      signal,
    });
    if (result.timedOut)
      throw new Error("Python runtime installation timed out");
    if (result.exitCode !== 0) {
      const diagnostic = sanitizeDiagnostic(result.stderr);
      throw new Error(
        `Python runtime installation failed with exit code ${result.exitCode}${diagnostic ? `: ${diagnostic}` : ""}`,
      );
    }
  }

  private privateEnvironmentExecutable(): string {
    return joinWindows(this.privateEnvironmentPath(), "Scripts\\python.exe");
  }

  private privateEnvironmentPath(): string {
    return joinWindows(this.options.privateRuntimeRoot, "venv");
  }

  private optionError(): string | undefined {
    return !isAbsoluteWindowsPath(this.options.moduleRoot) ||
      !isAbsoluteWindowsPath(this.options.privateRuntimeRoot)
      ? "ScanSci module and private runtime roots must be absolute Windows paths"
      : undefined;
  }

  private async loadSourceRules(): Promise<SourceRules> {
    const raw = await this.runtime.files.readText(
      joinWindows(this.options.moduleRoot, "source-rules-v3.json"),
    );
    return parseSourceRules(JSON.parse(raw) as unknown);
  }

  private async resolveDownloadPaths(
    request: OnePaperDownloadRequest,
  ): Promise<Readonly<{ destination: string; finalTarget: string }>> {
    if (!isAbsoluteWindowsPath(request.downloadDestination)) {
      throw new Error("Download destination must be an absolute Windows path");
    }
    if (!isAbsoluteWindowsPath(request.canonicalFinalTarget)) {
      throw new Error(
        "Canonical final target must be an absolute Windows path",
      );
    }
    const requestedDestination = normalizeWindowsPath(
      request.downloadDestination,
    );
    if (!(await this.runtime.files.pathExists(requestedDestination))) {
      await this.runtime.files.createDirectory(requestedDestination);
    }
    const destination =
      await this.runtime.files.canonicalizeExisting(requestedDestination);
    const targetName = basenameWindows(request.canonicalFinalTarget);
    if (!targetName || targetName === "." || targetName === "..") {
      throw new Error("Canonical final target must name a file");
    }
    const targetParent = await this.runtime.files.canonicalizeExisting(
      dirnameWindows(normalizeWindowsPath(request.canonicalFinalTarget)),
    );
    if (!isContainedWindowsPath(destination, targetParent)) {
      throw new Error(
        "Canonical final target is outside the download destination",
      );
    }
    return {
      destination,
      finalTarget: joinWindows(targetParent, targetName),
    };
  }

  private async discoverPythonCommands(
    signal?: AbortSignal,
  ): Promise<
    Readonly<{ commands: readonly string[]; launcherFailure?: string }>
  > {
    const commands: string[] = [];
    let launcherFailure: string | undefined;
    try {
      throwIfAborted(signal);
      const launcher = await this.runtime.runProcess({
        command: "py",
        arguments: ["-0p"],
        stdin: "",
        timeoutMilliseconds: DISCOVERY_TIMEOUT_MILLISECONDS,
        removeEnvironment: PROXY_ENVIRONMENT_VARIABLES,
        signal,
      });
      if (launcher.timedOut) {
        launcherFailure = "Python launcher enumeration timed out";
      } else if (launcher.exitCode !== 0) {
        const diagnostic = sanitizeDiagnostic(launcher.stderr);
        launcherFailure = `Python launcher enumeration failed with exit code ${launcher.exitCode}${diagnostic ? `: ${diagnostic}` : ""}`;
      } else {
        commands.push(...parsePythonLauncherPaths(launcher.stdout));
      }
    } catch (error) {
      if (isAbortError(error)) throw error;
      launcherFailure = `Python launcher enumeration failed: ${originalError(error)}`;
    }
    commands.push("python");
    return {
      commands: [
        ...new Set(commands.map((command) => command.trim()).filter(Boolean)),
      ],
      ...(launcherFailure ? { launcherFailure } : {}),
    };
  }

  private async probeExecutable(
    command: string,
    signal?: AbortSignal,
  ): Promise<ProbedCandidate> {
    let process: PythonProcessResult;
    try {
      process = await this.runtime.runProcess({
        command,
        arguments: ["-I", "-B", "-c", CAPABILITY_PROBE_SCRIPT],
        stdin: `${JSON.stringify(protocolRequest("probe", {}))}\n`,
        timeoutMilliseconds: CAPABILITY_TIMEOUT_MILLISECONDS,
        removeEnvironment: PROXY_ENVIRONMENT_VARIABLES,
        signal,
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      return {
        status: "failed",
        executable: command,
        error: originalError(error),
      };
    }
    if (process.timedOut) {
      return {
        status: "failed",
        executable: command,
        error: "Python capability probe timed out",
      };
    }
    if (process.exitCode !== 0) {
      const diagnostic = sanitizeDiagnostic(process.stderr);
      return {
        status: "failed",
        executable: command,
        error: `Python capability probe failed with exit code ${process.exitCode}${
          diagnostic ? `: ${diagnostic}` : ""
        }`,
      };
    }
    try {
      const response = parseProtocolResponse(process.stdout, "probe");
      return {
        status: "probed",
        result: parseCapabilityResult(response.result),
      };
    } catch (error) {
      return {
        status: "failed",
        executable: command,
        error: originalError(error),
      };
    }
  }
}

function protocolRequest(operation: string, request: unknown) {
  return {
    schemaVersion: SCANSCI_SCHEMA_VERSION,
    sourceRulesVersion: SCANSCI_SOURCE_RULES_VERSION,
    operation,
    request,
  };
}

function parseProtocolResponse(
  stdout: string,
  expectedOperation: string,
): { result: unknown } {
  const lines = stdout.split(/\r?\n/u).filter((line) => line.length > 0);
  if (lines.length !== 1) {
    throw new Error("Python stdout must contain exactly one protocol message");
  }
  const parsed: unknown = JSON.parse(lines[0] ?? "");
  if (!isRecord(parsed)) throw new Error("Python protocol response is invalid");
  if (parsed.schemaVersion !== SCANSCI_SCHEMA_VERSION) {
    throw new Error("Python protocol schema version is incompatible");
  }
  if (parsed.sourceRulesVersion !== SCANSCI_SOURCE_RULES_VERSION) {
    throw new Error("Python source-rules version is incompatible");
  }
  if (parsed.operation !== expectedOperation) {
    throw new Error("Python protocol operation failed");
  }
  if (parsed.ok !== true) {
    if (isRecord(parsed.error) && typeof parsed.error.message === "string") {
      throw new Error(sanitizeDiagnostic(parsed.error.message));
    }
    throw new Error("Python protocol operation failed");
  }
  return { result: parsed.result };
}

type ParsedCapabilityResult = {
  executable: string;
  pythonVersion: string;
  architecture: ScanSciArchitecture;
  moduleVersion: string;
  dependencies: readonly ScanSciDependency[];
  features: {
    onePaperDownload: "available" | "unavailable";
    visibleLogin: "available" | "disabled";
  };
};

type ProbedCandidate =
  | Readonly<{ status: "probed"; result: ParsedCapabilityResult }>
  | Readonly<{ status: "failed"; executable: string; error: string }>;

type SourceRule = Readonly<{
  id: string;
  enabled: boolean;
  kind: "open-access" | "institution";
  allowedHosts: readonly string[];
  disabledReason?: string;
}>;

type SourceRules = Readonly<{
  routes: readonly SourceRule[];
  prohibitedSources: readonly string[];
}>;

type DownloadSourceEvidence = Readonly<{
  id: string;
  url: string;
  egressHosts: readonly string[];
}>;

function parseCapabilityResult(value: unknown): ParsedCapabilityResult {
  if (!isRecord(value)) throw new Error("Python capability result is invalid");
  const architecture = value.architecture;
  if (
    architecture !== "x64" &&
    architecture !== "arm64" &&
    architecture !== "x86"
  ) {
    throw new Error("Python architecture is invalid");
  }
  if (
    typeof value.executable !== "string" ||
    !isAbsoluteWindowsPath(value.executable) ||
    typeof value.pythonVersion !== "string" ||
    value.moduleVersion !== "3.0.0" ||
    !Array.isArray(value.dependencies) ||
    !isRecord(value.features) ||
    (value.features.onePaperDownload !== "available" &&
      value.features.onePaperDownload !== "unavailable") ||
    (value.features.visibleLogin !== "available" &&
      value.features.visibleLogin !== "disabled")
  ) {
    throw new Error("Python capability result is incomplete");
  }
  const dependencies = value.dependencies.map((dependency) => {
    if (
      !isRecord(dependency) ||
      typeof dependency.name !== "string" ||
      typeof dependency.requirement !== "string" ||
      (dependency.installedVersion !== undefined &&
        typeof dependency.installedVersion !== "string") ||
      (dependency.status !== "available" &&
        dependency.status !== "missing" &&
        dependency.status !== "incompatible")
    ) {
      throw new Error("Python dependency capability is invalid");
    }
    return {
      name: dependency.name,
      requirement: dependency.requirement,
      ...(dependency.installedVersion
        ? { installedVersion: dependency.installedVersion }
        : {}),
      status: dependency.status,
    } satisfies ScanSciDependency;
  });
  const dependencyVersions = new Map(
    dependencies.map((dependency) => [dependency.name, dependency.requirement]),
  );
  if (
    dependencies.length !== LOCKED_DEPENDENCIES.length ||
    LOCKED_DEPENDENCIES.some(
      (dependency) =>
        dependencyVersions.get(dependency[0]) !== `==${dependency[2]}`,
    )
  ) {
    throw new Error(
      "Python dependency capability does not match the hash lock",
    );
  }
  return {
    executable: value.executable,
    pythonVersion: value.pythonVersion,
    architecture,
    moduleVersion: value.moduleVersion,
    dependencies,
    features: {
      onePaperDownload: value.features.onePaperDownload,
      visibleLogin: value.features.visibleLogin,
    },
  };
}

function parseSourceRules(value: unknown): SourceRules {
  if (
    !isRecord(value) ||
    value.schemaVersion !== SCANSCI_SCHEMA_VERSION ||
    value.sourceRulesVersion !== SCANSCI_SOURCE_RULES_VERSION ||
    !Array.isArray(value.routes) ||
    !Array.isArray(value.prohibitedSources) ||
    !isRecord(value.forcedPolicy) ||
    value.forcedPolicy.strategy !== FORCED_POLICY.strategy ||
    value.forcedPolicy.scihubEnabled !== FORCED_POLICY.scihubEnabled ||
    value.forcedPolicy.useTor !== FORCED_POLICY.useTor ||
    value.forcedPolicy.useVpnsci !== FORCED_POLICY.useVpnsci ||
    !Array.isArray(value.removedEnvironment) ||
    value.removedEnvironment.length !== PROXY_ENVIRONMENT_VARIABLES.length ||
    !value.removedEnvironment.every(
      (name, index) => name === PROXY_ENVIRONMENT_VARIABLES[index],
    )
  ) {
    throw new Error("ScanSci source-rules file is incompatible");
  }
  const routes = value.routes.map((candidate) => {
    if (
      !isRecord(candidate) ||
      typeof candidate.id !== "string" ||
      typeof candidate.enabled !== "boolean" ||
      (candidate.kind !== "open-access" && candidate.kind !== "institution") ||
      !Array.isArray(candidate.allowedHosts) ||
      !candidate.allowedHosts.every((host) => typeof host === "string") ||
      (candidate.disabledReason !== undefined &&
        typeof candidate.disabledReason !== "string")
    ) {
      throw new Error("ScanSci source-rules route is invalid");
    }
    const kind: SourceRule["kind"] = candidate.kind;
    return {
      id: candidate.id,
      enabled: candidate.enabled,
      kind,
      allowedHosts: candidate.allowedHosts as string[],
      ...(candidate.disabledReason
        ? { disabledReason: candidate.disabledReason }
        : {}),
    };
  });
  if (new Set(routes.map((route) => route.id)).size !== routes.length) {
    throw new Error("ScanSci source-rules routes must have unique ids");
  }
  if (!value.prohibitedSources.every((source) => typeof source === "string")) {
    throw new Error("ScanSci prohibited-source list is invalid");
  }
  for (const required of ["scihub", "libgen", "scibban", "tor", "vpnsci"]) {
    if (!value.prohibitedSources.includes(required)) {
      throw new Error(`ScanSci prohibited-source list is missing ${required}`);
    }
  }
  return {
    routes,
    prohibitedSources: value.prohibitedSources as string[],
  };
}

function parseDownloadResult(value: unknown): Readonly<{
  source: DownloadSourceEvidence;
  outputPath: string;
}> {
  if (
    !isRecord(value) ||
    typeof value.outputPath !== "string" ||
    !isRecord(value.source) ||
    typeof value.source.id !== "string" ||
    typeof value.source.url !== "string" ||
    !Array.isArray(value.source.egressHosts) ||
    !value.source.egressHosts.every((host) => typeof host === "string")
  ) {
    throw new Error("ScanSci download result is invalid");
  }
  return {
    outputPath: value.outputPath,
    source: {
      id: value.source.id,
      url: value.source.url,
      egressHosts: value.source.egressHosts as string[],
    },
  };
}

function validateLegalSource(
  source: DownloadSourceEvidence,
  rules: SourceRules,
): void {
  const sourceID = source.id.toLowerCase();
  if (
    rules.prohibitedSources.some(
      (prohibited) => prohibited.toLowerCase() === sourceID,
    )
  ) {
    throw new Error(`Prohibited ScanSci source: ${source.id}`);
  }
  const route = rules.routes.find(
    (candidate) => candidate.id.toLowerCase() === sourceID,
  );
  if (!route?.enabled || route.kind !== "open-access") {
    throw new Error(`Unknown or disabled ScanSci source: ${source.id}`);
  }
  let sourceURL: URL;
  try {
    sourceURL = new URL(source.url);
  } catch {
    throw new Error("ScanSci source URL is invalid");
  }
  const allowedHosts = new Set(
    route.allowedHosts.map((host) => host.toLowerCase()),
  );
  if (
    sourceURL.protocol !== "https:" ||
    !allowedHosts.has(sourceURL.hostname.toLowerCase()) ||
    source.egressHosts.length === 0 ||
    source.egressHosts.some((host) => !allowedHosts.has(host.toLowerCase()))
  ) {
    throw new Error(
      `ScanSci source ${source.id} failed strict egress validation`,
    );
  }
}

function protocolPaper(paper: OnePaperDownloadRequest["paper"]) {
  if (!paper.title.trim()) throw new Error("Confirmed paper title is required");
  if (!paper.doi && !paper.arxivID && !paper.pmcid) {
    throw new Error("Confirmed paper requires DOI, arXiv id, or PMCID");
  }
  return {
    title: paper.title,
    ...(paper.doi ? { doi: paper.doi } : {}),
    ...(paper.arxivID ? { arxivID: paper.arxivID } : {}),
    ...(paper.pmcid ? { pmcid: paper.pmcid } : {}),
    ...(paper.primaryResultURL
      ? { primaryResultURL: paper.primaryResultURL }
      : {}),
  };
}

function availableCapability(
  result: ParsedCapabilityResult,
  selectionReason:
    "configured override" | "automatic detection" | "private environment",
): ScanSciCapability {
  return {
    status: "available",
    executable: result.executable,
    pythonVersion: result.pythonVersion,
    architecture: result.architecture,
    moduleVersion: result.moduleVersion,
    dependencies: result.dependencies,
    features: {
      onePaperDownload: "available",
      visibleLogin: result.features.visibleLogin,
    },
    schemaVersion: SCANSCI_SCHEMA_VERSION,
    sourceRulesVersion: SCANSCI_SOURCE_RULES_VERSION,
    selectionReason,
  };
}

function candidateIncompatibility(
  candidate: ParsedCapabilityResult,
  hostArchitecture: ScanSciArchitecture | undefined,
): string | undefined {
  if (!isSupportedPythonVersion(candidate.pythonVersion)) {
    return `Python ${candidate.pythonVersion} is older than 3.11`;
  }
  if (hostArchitecture && candidate.architecture !== hostArchitecture) {
    return `Python architecture ${candidate.architecture} does not match host architecture ${hostArchitecture}`;
  }
  if (
    candidate.dependencies.some(
      (dependency) => dependency.status !== "available",
    )
  ) {
    return "Python dependencies are missing or incompatible";
  }
  if (candidate.features.onePaperDownload !== "available") {
    return "Python one-paper download capability is unavailable";
  }
  return undefined;
}

function candidateBaseIncompatibility(
  candidate: ParsedCapabilityResult,
  hostArchitecture: ScanSciArchitecture,
): string | undefined {
  if (!isSupportedPythonVersion(candidate.pythonVersion)) {
    return `Python ${candidate.pythonVersion} is older than 3.11`;
  }
  if (candidate.architecture !== hostArchitecture) {
    return `Python architecture ${candidate.architecture} does not match host architecture ${hostArchitecture}`;
  }
  if (
    candidate.features.onePaperDownload !== "available" &&
    candidate.dependencies.every(
      (dependency) => dependency.status === "available",
    )
  ) {
    return "Python one-paper download capability is unavailable";
  }
  return undefined;
}

function reportCandidates(
  candidates: readonly ProbedCandidate[],
): readonly ScanSciRuntimeCandidate[] {
  return candidates.map((candidate) =>
    candidate.status === "probed"
      ? candidate.result
      : {
          executable: candidate.executable,
          dependencies: [],
          error: candidate.error,
        },
  );
}

function validateRequirementsLock(
  expected: ScanSciInstallPlan["packages"],
  rawLock: string,
): void {
  const logicalLines = rawLock
    .replace(/\\\r?\n\s*/gu, " ")
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  const actual = logicalLines.map((line) => {
    const requirement = /^([A-Za-z0-9_.-]+)==([^\s]+)(.*)$/u.exec(line);
    if (!requirement) throw new Error("ScanSci requirements lock is invalid");
    const hashes = [
      ...(requirement[3] ?? "").matchAll(
        /(?:^|\s)--hash=sha256:([0-9a-f]{64})(?=\s|$)/gu,
      ),
    ].map((match) => match[1] ?? "");
    const residue = (requirement[3] ?? "")
      .replace(/(?:^|\s)--hash=sha256:[0-9a-f]{64}(?=\s|$)/gu, "")
      .trim();
    if (!hashes.length || residue) {
      throw new Error("ScanSci requirements lock must be hash-only");
    }
    return {
      name: requirement[1] ?? "",
      version: requirement[2] ?? "",
      sha256: hashes,
    };
  });
  if (
    actual.length !== expected.length ||
    actual.some((pkg, index) => {
      const planned = expected[index];
      return (
        !planned ||
        pkg.name !== planned.name ||
        pkg.version !== planned.version ||
        pkg.sha256.length !== planned.sha256.length ||
        pkg.sha256.some((hash, hashIndex) => hash !== planned.sha256[hashIndex])
      );
    })
  ) {
    throw new Error(
      "ScanSci requirements lock does not match the confirmed installation plan",
    );
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw abortError();
}

function abortError(): Error {
  return new DOMException("The operation was aborted", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isSupportedPythonVersion(version: string): boolean {
  const [major = 0, minor = 0] = version
    .split(".")
    .slice(0, 2)
    .map((part) => Number.parseInt(part, 10));
  return (
    major > MINIMUM_PYTHON_VERSION[0] ||
    (major === MINIMUM_PYTHON_VERSION[0] && minor >= MINIMUM_PYTHON_VERSION[1])
  );
}

function compareCapabilityCandidates(
  left: ParsedCapabilityResult,
  right: ParsedCapabilityResult,
): number {
  const versionOrder = compareVersions(right.pythonVersion, left.pythonVersion);
  return (
    versionOrder ||
    normalizeWindowsPath(left.executable)
      .toLowerCase()
      .localeCompare(normalizeWindowsPath(right.executable).toLowerCase())
  );
}

function compareInstallCandidates(
  left: ParsedCapabilityResult,
  right: ParsedCapabilityResult,
): number {
  const dependencyOrder =
    unavailableDependencyCount(left) - unavailableDependencyCount(right);
  return dependencyOrder || compareCapabilityCandidates(left, right);
}

function unavailableDependencyCount(candidate: ParsedCapabilityResult): number {
  return candidate.dependencies.filter(
    (dependency) => dependency.status !== "available",
  ).length;
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map((part) => Number.parseInt(part, 10));
  const rightParts = right.split(".").map((part) => Number.parseInt(part, 10));
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

function parsePythonLauncherPaths(output: string): readonly string[] {
  const paths: string[] = [];
  for (const line of output.split(/\r?\n/u)) {
    const match = /^\s*-V:\S+\s+\*?\s*(.+?python(?:\.exe)?)\s*$/iu.exec(line);
    if (match?.[1] && isAbsoluteWindowsPath(match[1])) paths.push(match[1]);
  }
  return paths;
}

function isAbsoluteWindowsPath(path: string): boolean {
  if (/^\\\\[?.]\\/u.test(path)) return false;
  return /^[A-Za-z]:[\\/]/u.test(path) || /^\\\\[^\\]+\\[^\\]+/u.test(path);
}

function normalizeWindowsPath(path: string): string {
  const normalizedSeparators = path.replace(/\//gu, "\\");
  const rootMatch = /^([A-Za-z]:\\|\\\\[^\\]+\\[^\\]+\\?)/u.exec(
    normalizedSeparators,
  );
  if (!rootMatch) return normalizedSeparators;
  const root = rootMatch[1] ?? "";
  const segments = normalizedSeparators
    .slice(root.length)
    .split("\\")
    .filter((segment) => segment && segment !== ".");
  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment === "..") resolved.pop();
    else resolved.push(segment);
  }
  return `${root.replace(/\\+$/u, "\\")}${resolved.join("\\")}`.replace(
    /\\+$/u,
    resolved.length === 0 ? "\\" : "",
  );
}

function dirnameWindows(path: string): string {
  const normalized = path.replace(/\//gu, "\\").replace(/\\+$/u, "");
  const separator = normalized.lastIndexOf("\\");
  return separator <= 2
    ? normalized.slice(0, separator + 1)
    : normalized.slice(0, separator);
}

function basenameWindows(path: string): string {
  const normalized = path.replace(/\//gu, "\\").replace(/\\+$/u, "");
  return normalized.slice(normalized.lastIndexOf("\\") + 1);
}

function sameWindowsPath(left: string, right: string): boolean {
  return (
    normalizeWindowsPath(left).toLowerCase() ===
    normalizeWindowsPath(right).toLowerCase()
  );
}

function isContainedWindowsPath(parent: string, child: string): boolean {
  const normalizedParent = normalizeWindowsPath(parent).toLowerCase();
  const normalizedChild = normalizeWindowsPath(child).toLowerCase();
  return (
    normalizedChild === normalizedParent ||
    normalizedChild.startsWith(`${normalizedParent.replace(/\\+$/u, "")}\\`)
  );
}

function joinWindows(left: string, right: string): string {
  return `${left.replace(/[\\/]+$/u, "")}\\${right.replace(/^[\\/]+/u, "")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function originalError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sanitizeDiagnostic(value: string): string {
  const withoutQueries = value.replace(/https?:\/\/[^\s]+/giu, (raw) => {
    try {
      const url = new URL(raw);
      return `${url.origin}${url.pathname}${
        url.search || url.hash ? "?[query omitted]" : ""
      }`;
    } catch {
      return "[URL omitted]";
    }
  });
  return stripControlCharacters(withoutQueries)
    .replace(
      /\b(password|passcode|token|cookie|authorization|api[_-]?key)\s*[:=]\s*[^\s]+/giu,
      "$1=[redacted]",
    )
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, MAX_DIAGNOSTIC_CHARACTERS);
}

function stripControlCharacters(value: string): string {
  return [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127 ? " " : character;
    })
    .join("");
}
