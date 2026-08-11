import {
  SCANSCI_SCHEMA_VERSION,
  SCANSCI_SIDECAR_CONTRACT_VERSION,
  SCANSCI_SIDECAR_PROTOCOL,
  SCANSCI_SIDECAR_RESULT_SCHEMA_VERSION,
  SCANSCI_SOURCE_RULES_VERSION,
  type OnePaperDownloadResult,
  type PaperDownloadItemResult,
  type PaperDownloadRequest,
  type ScanSciArchitecture,
  type ScanSciCapability,
  type ScanSciDependency,
  type ScanSciInstallPlan,
  type ScanSciPort,
  type ScanSciRuntimeCandidate,
  type ScanSciRuntimePreparation,
  type VisibleLoginResult,
} from "./scan-sci-port";
import {
  createSidecarRequest,
  parseDownloadBatchPayload,
  parseDownloadOnePayload,
  parseProbePayload,
  parseSidecarMessage,
  protocolPaper,
  type SidecarDownloadResult,
  type SidecarMessage,
  type SidecarOperation,
  type SidecarProbe,
} from "./sidecar-protocol";

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
result = {"executable": str(__import__("pathlib").Path(sys.executable).resolve()), "pythonVersion": platform.python_version(), "architecture": architecture, "dependencies": dependencies}
print(json.dumps(result, separators=(",", ":")))
`.trim();

export type PythonProcessRequest = Readonly<{
  command: string;
  arguments: readonly string[];
  stdin: string;
  timeoutMilliseconds: number;
  removeEnvironment: readonly string[];
  workingDirectory?: string;
  signal?: AbortSignal;
  onStdoutLine?(line: string): void | Promise<void>;
}>;

export type PythonProcessResult = Readonly<{
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
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
    try {
      await this.runtime.ensureModuleAssets();
    } catch (error) {
      return {
        status: "unavailable",
        error: `ScanSci sidecar assets are unavailable: ${originalError(error)}`,
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
    try {
      const executable = await this.requireReadyExecutable();
      const requestID = this.nextRequestID();
      await this.invokeSidecar(
        executable,
        requestID,
        "visibleLogin",
        { routeId: request.routeID, userInitiated: true },
        DEFAULT_DOWNLOAD_TIMEOUT_MILLISECONDS,
      );
      await this.requireReadyExecutable();
      return { status: "ready", routeID: request.routeID };
    } catch (error) {
      return { status: "failed", error: originalError(error) };
    }
  }

  async downloadPapers(
    request: PaperDownloadRequest,
  ): Promise<readonly PaperDownloadItemResult[]> {
    if (request.items.length === 0) return [];
    if (request.items.length > 500) {
      throw new Error("ScanSci batch cannot contain more than 500 papers");
    }
    if (
      new Set(request.items.map(({ itemID }) => itemID)).size !==
      request.items.length
    ) {
      throw new Error("ScanSci download item ids must be unique");
    }
    let requestDirectory: string | undefined;
    let requestDirectoryOwned = false;
    let canonicalOwnedRequestDirectory: string | undefined;
    let completedNormally = false;
    const outcomes = new Map<string, OnePaperDownloadResult>();
    const sidecarOutcomes = new Map<string, SidecarDownloadResult>();
    const committed = new Set<string>();
    try {
      throwIfAborted(request.signal);
      const paths = await Promise.all(
        request.items.map(async (item) => ({
          item,
          paths: await this.resolveDownloadPaths(
            request.downloadDestination,
            item.canonicalFinalTarget,
          ),
        })),
      );
      const destination = paths[0]?.paths.destination;
      if (!destination)
        throw new Error("ScanSci download destination is missing");
      if (
        paths.some(
          ({ paths: current }) =>
            !sameWindowsPath(current.destination, destination),
        )
      ) {
        throw new Error(
          "All ScanSci batch items must use one download destination",
        );
      }
      const executable = await this.requireReadyExecutable(request.signal);
      const timeoutMilliseconds =
        request.timeoutMilliseconds ?? DEFAULT_DOWNLOAD_TIMEOUT_MILLISECONDS;
      if (!Number.isFinite(timeoutMilliseconds) || timeoutMilliseconds <= 0) {
        throw new Error("ScanSci download timeout must be positive");
      }
      const rules = await this.loadSourceRules();
      const requestID = this.nextRequestID();
      const cacheRoot = joinWindows(destination, "ScanSciCache");
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

      const bySidecarID = new Map(
        paths.map(({ item, paths: itemPaths }, index) => [
          `item-${index + 1}`,
          { item, paths: itemPaths },
        ]),
      );
      const operation =
        request.items.length === 1 ? "downloadOne" : "downloadBatch";
      const params =
        operation === "downloadOne"
          ? {
              paper: protocolPaper(request.items[0]!.paper),
              outputDir: requestDirectory,
            }
          : {
              items: [...bySidecarID].map(([itemId, { item }]) => ({
                itemId,
                paper: protocolPaper(item.paper),
              })),
              outputDir: requestDirectory,
            };
      let expectedProgressSequence = 1;
      const progress = async (message: SidecarMessage): Promise<void> => {
        if (message.type !== "progress") return;
        if (
          message.payload.sequence !== expectedProgressSequence ||
          message.payload.total !== bySidecarID.size
        ) {
          throw new Error("ScanSci sidecar batch progress sequence is invalid");
        }
        expectedProgressSequence += 1;
        const target = bySidecarID.get(message.payload.itemID);
        if (!target || outcomes.has(target.item.itemID)) {
          throw new Error(
            "ScanSci sidecar emitted duplicate or unknown batch progress",
          );
        }
        sidecarOutcomes.set(message.payload.itemID, message.payload.result);
        const result = await this.finalizeDownload(
          message.payload.result,
          target.item,
          target.paths,
          canonicalRequestDirectory,
          rules,
        );
        outcomes.set(target.item.itemID, result);
        if (result.status === "downloaded") committed.add(target.item.itemID);
        request.onProgress?.({ itemID: target.item.itemID, result });
      };
      const payload = await this.invokeSidecar(
        executable,
        requestID,
        operation,
        params,
        timeoutMilliseconds,
        requestDirectory,
        request.signal,
        progress,
      );
      completedNormally = true;
      if (operation === "downloadOne") {
        const target = bySidecarID.get("item-1")!;
        const result = await this.finalizeDownload(
          parseDownloadOnePayload(payload),
          target.item,
          target.paths,
          canonicalRequestDirectory,
          rules,
        );
        outcomes.set(target.item.itemID, result);
        if (result.status === "downloaded") committed.add(target.item.itemID);
        request.onProgress?.({ itemID: target.item.itemID, result });
      } else {
        const finalItems = parseDownloadBatchPayload(payload);
        if (
          finalItems.length !== bySidecarID.size ||
          outcomes.size !== bySidecarID.size
        ) {
          throw new Error("ScanSci sidecar batch did not complete every paper");
        }
        for (const finalItem of finalItems) {
          const target = bySidecarID.get(finalItem.itemID);
          if (
            !target ||
            !sameSidecarResult(
              finalItem.result,
              sidecarOutcomes.get(finalItem.itemID),
            )
          ) {
            throw new Error(
              "ScanSci sidecar batch completion disagrees with progress",
            );
          }
        }
      }
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (error instanceof SidecarOperationError) completedNormally = true;
      const failed = { status: "failed", error: originalError(error) } as const;
      for (const item of request.items) {
        if (!outcomes.has(item.itemID)) {
          outcomes.set(item.itemID, failed);
          request.onProgress?.({ itemID: item.itemID, result: failed });
        }
      }
    }
    if (requestDirectory && requestDirectoryOwned && completedNormally) {
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
        for (const [itemID, result] of outcomes) {
          if (result.status === "downloaded" && committed.has(itemID)) {
            outcomes.set(itemID, { ...result, cleanupWarning: cleanupError });
          } else if (result.status === "failed") {
            outcomes.set(itemID, {
              status: "failed",
              error: `${result.error}; ${cleanupError}`,
            });
          }
        }
      }
    }
    return request.items.map((item) => ({
      itemID: item.itemID,
      result:
        outcomes.get(item.itemID) ??
        ({ status: "failed", error: "ScanSci returned no result" } as const),
    }));
  }

  private async finalizeDownload(
    sidecarResult: SidecarDownloadResult,
    item: PaperDownloadRequest["items"][number],
    paths: Readonly<{ destination: string; finalTarget: string }>,
    requestDirectory: string,
    rules: SourceRules,
  ): Promise<OnePaperDownloadResult> {
    if (
      sidecarResult.identifier.toLowerCase() !==
      paperIdentifier(item.paper).toLowerCase()
    ) {
      return {
        status: "failed",
        error: "ScanSci result identifier does not match the requested paper",
      };
    }
    if (sidecarResult.status === "failed") {
      return {
        status: "failed",
        error: `${sidecarResult.error.code}: ${sidecarResult.error.message}`,
      };
    }
    try {
      validateLegalSource(
        {
          id: sidecarResult.sourceEvidence.source,
          url: sidecarResult.sourceEvidence.sourceURL,
          egressHosts: sidecarResult.sourceEvidence.egressHosts,
        },
        rules,
      );
      const relativePath = sidecarRelativePath(sidecarResult.relativePath);
      const output = await this.runtime.files.canonicalizeExisting(
        joinWindows(requestDirectory, relativePath),
      );
      if (!isContainedWindowsPath(requestDirectory, output)) {
        throw new Error("ScanSci output escaped its request directory");
      }
      await this.runtime.files.copyExclusiveContained(
        output,
        paths.destination,
        paths.finalTarget,
      );
      return { status: "downloaded", savedPath: paths.finalTarget };
    } catch (error) {
      return { status: "failed", error: originalError(error) };
    }
  }

  private nextRequestID(): string {
    const requestID = this.runtime.nextRequestID();
    if (!REQUEST_ID_PATTERN.test(requestID)) {
      throw new Error("ScanSci request id is invalid");
    }
    return requestID;
  }

  private async requireReadyExecutable(signal?: AbortSignal): Promise<string> {
    if (this.activeExecutable) {
      const refreshed = await this.probeExecutable(
        this.activeExecutable,
        signal,
      );
      if (
        refreshed.status !== "probed" ||
        candidateIncompatibility(
          refreshed.result,
          this.options.hostArchitecture,
        )
      ) {
        const error =
          refreshed.status === "failed"
            ? refreshed.error
            : candidateIncompatibility(
                refreshed.result,
                this.options.hostArchitecture,
              );
        this.activeExecutable = undefined;
        throw new Error(
          `ScanSci runtime probe failed before operation: ${error}`,
        );
      }
      return refreshed.result.executable;
    }
    const preparation = await this.prepareRuntime({
      allowInstall: false,
      signal,
    });
    if (preparation.status !== "ready") {
      throw new Error(
        preparation.status === "needs-install"
          ? "ScanSci runtime dependencies require confirmed installation"
          : preparation.error,
      );
    }
    return preparation.capability.executable;
  }

  private async invokeSidecar(
    executable: string,
    requestID: string,
    operation: SidecarOperation,
    params: Readonly<Record<string, unknown>>,
    timeoutMilliseconds: number,
    workingDirectory?: string,
    signal?: AbortSignal,
    onMessage?: (message: SidecarMessage) => void | Promise<void>,
  ): Promise<unknown> {
    const request = createSidecarRequest(requestID, operation, params);
    let completion: Extract<SidecarMessage, { type: "complete" }> | undefined;
    let consumedLines = 0;
    const consume = async (line: string): Promise<void> => {
      if (!line.trim()) return;
      if (completion) {
        throw new Error("ScanSci sidecar emitted data after completion");
      }
      consumedLines += 1;
      const message = parseSidecarMessage(line, { requestID, operation });
      if (message.type === "complete") completion = message;
      await onMessage?.(message);
    };
    const process = await this.runtime.runProcess({
      command: executable,
      arguments: [
        "-E",
        "-s",
        joinWindows(this.options.moduleRoot, "sidecar.py"),
      ],
      stdin: `${JSON.stringify(request)}\n`,
      timeoutMilliseconds,
      removeEnvironment: PROXY_ENVIRONMENT_VARIABLES,
      ...(workingDirectory ? { workingDirectory } : {}),
      ...(signal ? { signal } : {}),
      onStdoutLine: consume,
    });
    if (process.stdoutTruncated || process.stderrTruncated) {
      throw new Error("ScanSci sidecar exceeded its bounded output budget");
    }
    if (process.timedOut) throw new Error("ScanSci sidecar timed out");
    if (process.exitCode !== 0) {
      const diagnostic = sanitizeDiagnostic(process.stderr);
      throw new Error(
        `ScanSci sidecar failed with exit code ${process.exitCode}${
          diagnostic ? `: ${diagnostic}` : ""
        }`,
      );
    }
    if (consumedLines === 0) {
      for (const line of process.stdout.split(/\r?\n/u)) await consume(line);
    }
    if (!completion) {
      throw new Error("ScanSci sidecar exited without a completion message");
    }
    if (!completion.ok) {
      throw new SidecarOperationError(
        `${completion.error.code}: ${sanitizeDiagnostic(completion.error.message)}`,
      );
    }
    return completion.payload;
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
    downloadDestination: string,
    canonicalFinalTarget: string,
  ): Promise<Readonly<{ destination: string; finalTarget: string }>> {
    if (!isAbsoluteWindowsPath(downloadDestination)) {
      throw new Error("Download destination must be an absolute Windows path");
    }
    if (!isAbsoluteWindowsPath(canonicalFinalTarget)) {
      throw new Error(
        "Canonical final target must be an absolute Windows path",
      );
    }
    const requestedDestination = normalizeWindowsPath(downloadDestination);
    if (!(await this.runtime.files.pathExists(requestedDestination))) {
      await this.runtime.files.createDirectory(requestedDestination);
    }
    const destination =
      await this.runtime.files.canonicalizeExisting(requestedDestination);
    const targetName = basenameWindows(canonicalFinalTarget);
    if (!targetName || targetName === "." || targetName === "..") {
      throw new Error("Canonical final target must name a file");
    }
    const targetParent = await this.runtime.files.canonicalizeExisting(
      dirnameWindows(normalizeWindowsPath(canonicalFinalTarget)),
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
        stdin: "",
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
      if (process.stdoutTruncated || process.stderrTruncated) {
        throw new Error("Python runtime inspection exceeded its output budget");
      }
      const result = parseRuntimeInspection(process.stdout);
      if (
        result.dependencies.some(
          (dependency) => dependency.status !== "available",
        )
      ) {
        return { status: "probed", result };
      }
      const payload = await this.invokeSidecar(
        result.executable,
        this.nextRequestID(),
        "probe",
        {},
        CAPABILITY_TIMEOUT_MILLISECONDS,
        undefined,
        signal,
      );
      const sidecar = parseProbePayload(payload);
      if (
        !sameWindowsPath(sidecar.executable, result.executable) ||
        sidecar.pythonVersion !== result.pythonVersion ||
        sidecar.architecture !== result.architecture
      ) {
        throw new Error(
          "ScanSci sidecar runtime identity changed during probe",
        );
      }
      return {
        status: "probed",
        result: { ...result, sidecar },
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

type ParsedCapabilityResult = {
  executable: string;
  pythonVersion: string;
  architecture: ScanSciArchitecture;
  dependencies: readonly ScanSciDependency[];
  sidecar?: SidecarProbe;
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

function parseRuntimeInspection(stdout: string): ParsedCapabilityResult {
  const lines = stdout.split(/\r?\n/u).filter((line) => line.length > 0);
  if (lines.length !== 1) {
    throw new Error("Python runtime inspection must emit exactly one message");
  }
  const value: unknown = JSON.parse(lines[0] ?? "");
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
    !Array.isArray(value.dependencies)
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
    dependencies,
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

function paperIdentifier(
  paper: PaperDownloadRequest["items"][number]["paper"],
): string {
  const identifier = paper.doi ?? paper.arxivID ?? paper.pmcid;
  if (!identifier) {
    throw new Error("Confirmed paper requires DOI, arXiv id, or PMCID");
  }
  return identifier;
}

function sidecarRelativePath(value: string): string {
  if (
    !value ||
    /^[A-Za-z]:/u.test(value) ||
    value.startsWith("/") ||
    value.startsWith("\\")
  ) {
    throw new Error("ScanSci sidecar returned an absolute output path");
  }
  const segments = value.replace(/\\/gu, "/").split("/");
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.includes(":") ||
        containsControlCharacter(segment),
    )
  ) {
    throw new Error("ScanSci sidecar returned an invalid relative output path");
  }
  return segments.join("\\");
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

function sameSidecarResult(
  left: SidecarDownloadResult,
  right: SidecarDownloadResult | undefined,
): boolean {
  return right !== undefined && JSON.stringify(left) === JSON.stringify(right);
}

function availableCapability(
  result: ParsedCapabilityResult,
  selectionReason:
    "configured override" | "automatic detection" | "private environment",
): ScanSciCapability {
  if (!result.sidecar) {
    throw new Error("ScanSci sidecar capability is unavailable");
  }
  return {
    status: "available",
    executable: result.executable,
    pythonVersion: result.pythonVersion,
    architecture: result.architecture,
    moduleVersion: result.sidecar.applicationVersion,
    dependencies: result.dependencies,
    features: {
      onePaperDownload: "available",
      batchDownload: "available",
      visibleLogin: "disabled",
    },
    routes: result.sidecar.routes,
    sidecar: {
      protocol: SCANSCI_SIDECAR_PROTOCOL,
      contractVersion: SCANSCI_SIDECAR_CONTRACT_VERSION,
      resultSchemaVersion: SCANSCI_SIDECAR_RESULT_SCHEMA_VERSION,
      upstreamRevision: result.sidecar.upstreamRevision,
      dirty: false,
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
  if (!candidate.sidecar) {
    return "Versioned ScanSci sidecar capability is unavailable";
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
    !candidate.sidecar &&
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

class SidecarOperationError extends Error {}

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
