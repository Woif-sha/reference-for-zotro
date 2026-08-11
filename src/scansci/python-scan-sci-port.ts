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
  type ScanSciPort,
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
import { canonicalPdfFilename } from "./windows-download-path";

const CAPABILITY_TIMEOUT_MILLISECONDS = 10_000;
const DISCOVERY_TIMEOUT_MILLISECONDS = 5_000;
const MINIMUM_PYTHON_VERSION = [3, 11] as const;
const DEFAULT_DOWNLOAD_TIMEOUT_MILLISECONDS = 120_000;
const MAX_DIAGNOSTIC_CHARACTERS = 1_024;
const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const REMOVED_ENVIRONMENT = [
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
  commitExclusiveContained(
    sourceRoot: string,
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

  async probe(
    request: Readonly<{ signal?: AbortSignal }> = {},
  ): Promise<ScanSciCapability> {
    throwIfAborted(request.signal);
    if (!isAbsoluteWindowsPath(this.options.moduleRoot)) {
      throw new Error("ScanSci sidecar root must be an absolute Windows path");
    }
    try {
      await this.runtime.ensureModuleAssets();
    } catch (error) {
      throw new Error(
        `ScanSci sidecar assets are unavailable: ${originalError(error)}`,
        { cause: error },
      );
    }

    const candidates = await this.probeDiscoveredCandidates(request.signal);
    const compatible = candidates
      .filter(
        (
          candidate,
        ): candidate is Readonly<{ status: "probed"; result: SidecarProbe }> =>
          candidate.status === "probed" &&
          !candidateIncompatibility(
            candidate.result,
            this.options.hostArchitecture,
          ),
      )
      .map(({ result }) => result)
      .sort(compareCapabilities);
    const selected = compatible[0];
    if (!selected) {
      const details = candidates
        .map((candidate) =>
          candidate.status === "failed"
            ? `${candidate.command}: ${candidate.error}`
            : `${candidate.result.executable}: ${candidateIncompatibility(candidate.result, this.options.hostArchitecture)}`,
        )
        .join("; ");
      throw new Error(
        `No compatible ScanSci sidecar runtime was detected${details ? `: ${details}` : ""}`,
      );
    }
    this.activeExecutable = selected.executable;
    return capabilityFromProbe(selected);
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
      const executable = await this.requireCompatibleRuntime();
      await this.invokeSidecar(
        executable,
        this.nextRequestID(),
        "visibleLogin",
        { routeId: request.routeID, userInitiated: true },
        DEFAULT_DOWNLOAD_TIMEOUT_MILLISECONDS,
      );
      await this.probe();
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
      const executable = await this.requireCompatibleRuntime(request.signal);
      const timeoutMilliseconds =
        request.timeoutMilliseconds ?? DEFAULT_DOWNLOAD_TIMEOUT_MILLISECONDS;
      if (!Number.isFinite(timeoutMilliseconds) || timeoutMilliseconds <= 0) {
        throw new Error("ScanSci download timeout must be positive");
      }
      const rules = await this.loadSourceRules();
      const destination = await this.resolveDownloadDestination(
        request.downloadDestination,
      );
      const prepared: Array<
        Readonly<{
          item: PaperDownloadRequest["items"][number];
          paper: ReturnType<typeof protocolPaper>;
          paths: Readonly<{ destination: string; finalTarget: string }>;
        }>
      > = [];
      for (const item of request.items) {
        try {
          prepared.push({
            item,
            paper: protocolPaper(item.paper),
            paths: await this.resolveFinalTarget(destination, item),
          });
        } catch (error) {
          const failed = {
            status: "failed",
            error: originalError(error),
          } as const;
          outcomes.set(item.itemID, failed);
          request.onProgress?.({ itemID: item.itemID, result: failed });
        }
      }
      if (prepared.length === 0) {
        completedNormally = true;
        return request.items.map((item) => ({
          itemID: item.itemID,
          result: outcomes.get(item.itemID)!,
        }));
      }
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
        prepared.map(({ item, paper, paths: itemPaths }, index) => [
          `item-${index + 1}`,
          { item, paper, paths: itemPaths },
        ]),
      );
      const operation =
        request.items.length === 1 ? "downloadOne" : "downloadBatch";
      const params =
        operation === "downloadOne"
          ? {
              paper: prepared[0]!.paper,
              outputDir: requestDirectory,
            }
          : {
              items: [...bySidecarID].map(([itemId, { paper }]) => ({
                itemId,
                paper,
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
          sidecarOutcomes.size !== bySidecarID.size
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
        if (outcomes.has(item.itemID)) continue;
        outcomes.set(item.itemID, failed);
        request.onProgress?.({ itemID: item.itemID, result: failed });
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
      const requestedOutput = joinWindows(requestDirectory, relativePath);
      const canonicalOutput =
        await this.runtime.files.canonicalizeExisting(requestedOutput);
      if (!isContainedWindowsPath(requestDirectory, canonicalOutput)) {
        throw new Error("ScanSci output escaped its request directory");
      }
      await this.runtime.files.commitExclusiveContained(
        requestDirectory,
        requestedOutput,
        paths.destination,
        paths.finalTarget,
      );
      return { status: "downloaded", savedPath: paths.finalTarget };
    } catch (error) {
      return { status: "failed", error: originalError(error) };
    }
  }

  private async requireCompatibleRuntime(
    signal?: AbortSignal,
  ): Promise<string> {
    if (!this.activeExecutable)
      return (await this.probe({ signal })).executable;
    const refreshed = await this.probeCommand(this.activeExecutable, signal);
    const incompatibility =
      refreshed.status === "probed"
        ? candidateIncompatibility(
            refreshed.result,
            this.options.hostArchitecture,
          )
        : refreshed.error;
    if (incompatibility) {
      this.activeExecutable = undefined;
      throw new Error(
        `ScanSci runtime probe failed before operation: ${incompatibility}`,
      );
    }
    return refreshed.status === "probed"
      ? refreshed.result.executable
      : this.activeExecutable;
  }

  private nextRequestID(): string {
    const requestID = this.runtime.nextRequestID();
    if (!REQUEST_ID_PATTERN.test(requestID)) {
      throw new Error("ScanSci request id is invalid");
    }
    return requestID;
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
      removeEnvironment: REMOVED_ENVIRONMENT,
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
        `ScanSci sidecar failed with exit code ${process.exitCode}${diagnostic ? `: ${diagnostic}` : ""}`,
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
            command: "py launcher",
            error: discovery.launcherFailure,
          },
        ]
      : [];
    const commands = [
      ...new Set(
        [this.activeExecutable, ...discovery.commands].filter(
          (command): command is string => Boolean(command?.trim()),
        ),
      ),
    ];
    for (const command of commands) {
      throwIfAborted(signal);
      candidates.push(await this.probeCommand(command, signal));
    }
    return candidates;
  }

  private async discoverPythonCommands(
    signal?: AbortSignal,
  ): Promise<
    Readonly<{ commands: readonly string[]; launcherFailure?: string }>
  > {
    const commands: string[] = [];
    let launcherFailure: string | undefined;
    try {
      const launcher = await this.runtime.runProcess({
        command: "py",
        arguments: ["-0p"],
        stdin: "",
        timeoutMilliseconds: DISCOVERY_TIMEOUT_MILLISECONDS,
        removeEnvironment: REMOVED_ENVIRONMENT,
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
      commands: [...new Set(commands.map((command) => command.trim()))],
      ...(launcherFailure ? { launcherFailure } : {}),
    };
  }

  private async probeCommand(
    command: string,
    signal?: AbortSignal,
  ): Promise<ProbedCandidate> {
    try {
      const payload = await this.invokeSidecar(
        command,
        this.nextRequestID(),
        "probe",
        {},
        CAPABILITY_TIMEOUT_MILLISECONDS,
        undefined,
        signal,
      );
      return { status: "probed", result: parseProbePayload(payload) };
    } catch (error) {
      if (isAbortError(error)) throw error;
      return { status: "failed", command, error: originalError(error) };
    }
  }

  private async loadSourceRules(): Promise<SourceRules> {
    const raw = await this.runtime.files.readText(
      joinWindows(this.options.moduleRoot, "source-rules-v3.json"),
    );
    return parseSourceRules(JSON.parse(raw) as unknown);
  }

  private async resolveDownloadDestination(
    downloadDestination: string,
  ): Promise<string> {
    if (!isAbsoluteWindowsPath(downloadDestination)) {
      throw new Error("Download destination must be an absolute Windows path");
    }
    const requestedDestination = normalizeWindowsPath(downloadDestination);
    if (!(await this.runtime.files.pathExists(requestedDestination))) {
      await this.runtime.files.createDirectory(requestedDestination);
    }
    return this.runtime.files.canonicalizeExisting(requestedDestination);
  }

  private async resolveFinalTarget(
    destination: string,
    item: PaperDownloadRequest["items"][number],
  ): Promise<Readonly<{ destination: string; finalTarget: string }>> {
    if (!isAbsoluteWindowsPath(item.canonicalFinalTarget)) {
      throw new Error(
        "Canonical final target must be an absolute Windows path",
      );
    }
    const targetName = basenameWindows(item.canonicalFinalTarget);
    if (targetName !== canonicalPdfFilename(item.paper.title)) {
      throw new Error(
        "Canonical final target must use the Windows-safe paper title",
      );
    }
    const targetParent = await this.runtime.files.canonicalizeExisting(
      dirnameWindows(normalizeWindowsPath(item.canonicalFinalTarget)),
    );
    if (!sameWindowsPath(destination, targetParent)) {
      throw new Error(
        "Canonical final target is outside the download destination",
      );
    }
    return {
      destination,
      finalTarget: joinWindows(targetParent, targetName),
    };
  }
}

type ProbedCandidate =
  | Readonly<{ status: "probed"; result: SidecarProbe }>
  | Readonly<{ status: "failed"; command: string; error: string }>;

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

function parseSourceRules(value: unknown): SourceRules {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "sourceRulesVersion",
      "routes",
      "prohibitedSources",
      "forcedPolicy",
      "removedEnvironment",
    ]) ||
    value.schemaVersion !== SCANSCI_SCHEMA_VERSION ||
    value.sourceRulesVersion !== SCANSCI_SOURCE_RULES_VERSION ||
    !Array.isArray(value.routes) ||
    !Array.isArray(value.prohibitedSources) ||
    !isRecord(value.forcedPolicy) ||
    !hasExactKeys(value.forcedPolicy, [
      "strategy",
      "scihubEnabled",
      "useTor",
      "useVpnsci",
    ]) ||
    value.forcedPolicy.strategy !== FORCED_POLICY.strategy ||
    value.forcedPolicy.scihubEnabled !== FORCED_POLICY.scihubEnabled ||
    value.forcedPolicy.useTor !== FORCED_POLICY.useTor ||
    value.forcedPolicy.useVpnsci !== FORCED_POLICY.useVpnsci ||
    !Array.isArray(value.removedEnvironment) ||
    value.removedEnvironment.length !== REMOVED_ENVIRONMENT.length ||
    !value.removedEnvironment.every(
      (name, index) => name === REMOVED_ENVIRONMENT[index],
    )
  ) {
    throw new Error("ScanSci source-rules file is incompatible");
  }
  const routes = value.routes.map((candidate) => {
    const routeKeys =
      isRecord(candidate) && candidate.disabledReason !== undefined
        ? ["id", "enabled", "kind", "allowedHosts", "disabledReason"]
        : ["id", "enabled", "kind", "allowedHosts"];
    if (
      !isRecord(candidate) ||
      !hasExactKeys(candidate, routeKeys) ||
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
    return {
      id: candidate.id,
      enabled: candidate.enabled,
      kind: candidate.kind,
      allowedHosts: candidate.allowedHosts as string[],
      ...(candidate.disabledReason
        ? { disabledReason: candidate.disabledReason }
        : {}),
    } satisfies SourceRule;
  });
  if (new Set(routes.map(({ id }) => id)).size !== routes.length) {
    throw new Error("ScanSci source-rules routes must have unique ids");
  }
  const [arxiv, pmc, institution] = routes;
  if (
    routes.length !== 3 ||
    !arxiv ||
    arxiv.id !== "arxiv" ||
    arxiv.enabled !== true ||
    arxiv.kind !== "open-access" ||
    !sameStringSet(arxiv.allowedHosts, ["arxiv.org", "export.arxiv.org"]) ||
    arxiv.disabledReason !== undefined ||
    !pmc ||
    pmc.id !== "pmc" ||
    pmc.enabled !== true ||
    pmc.kind !== "open-access" ||
    !sameStringSet(pmc.allowedHosts, [
      "www.ncbi.nlm.nih.gov",
      "pmc.ncbi.nlm.nih.gov",
    ]) ||
    pmc.disabledReason !== undefined ||
    !institution ||
    institution.id !== "institution-browser" ||
    institution.enabled !== false ||
    institution.kind !== "institution" ||
    institution.allowedHosts.length !== 0 ||
    institution.disabledReason !==
      "Institution browser route is disabled pending strict-TLS, source, egress, Windows, and Zotero acceptance"
  ) {
    throw new Error("ScanSci source-rules route set is incompatible");
  }
  if (!value.prohibitedSources.every((source) => typeof source === "string")) {
    throw new Error("ScanSci prohibited-source list is invalid");
  }
  const requiredProhibitedSources = [
    "scihub",
    "libgen",
    "scibban",
    "tor",
    "proxy-pool",
    "vpnsci",
    "unknown",
  ];
  if (!sameStringSet(value.prohibitedSources, requiredProhibitedSources)) {
    throw new Error("ScanSci prohibited-source list is incompatible");
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
    sourceURL.port !== "" ||
    !allowedHosts.has(sourceURL.hostname.toLowerCase()) ||
    source.egressHosts.length === 0 ||
    source.egressHosts.some((host) => !allowedHosts.has(host.toLowerCase()))
  ) {
    throw new Error(
      `ScanSci source ${source.id} failed strict egress validation`,
    );
  }
}

function capabilityFromProbe(probe: SidecarProbe): ScanSciCapability {
  return {
    status: "available",
    executable: probe.executable,
    pythonVersion: probe.pythonVersion,
    architecture: probe.architecture,
    moduleVersion: probe.applicationVersion,
    schemaVersion: SCANSCI_SCHEMA_VERSION,
    sourceRulesVersion: SCANSCI_SOURCE_RULES_VERSION,
    dependencies: probe.dependencies,
    features: {
      onePaperDownload: "available",
      batchDownload: "available",
      visibleLogin: "disabled",
    },
    routes: probe.routes,
    sidecar: {
      protocol: SCANSCI_SIDECAR_PROTOCOL,
      contractVersion: SCANSCI_SIDECAR_CONTRACT_VERSION,
      resultSchemaVersion: SCANSCI_SIDECAR_RESULT_SCHEMA_VERSION,
      upstreamRevision: probe.upstreamRevision,
      dirty: false,
    },
  };
}

function candidateIncompatibility(
  candidate: SidecarProbe,
  hostArchitecture: ScanSciArchitecture,
): string | undefined {
  if (!isSupportedPythonVersion(candidate.pythonVersion)) {
    return `Python ${candidate.pythonVersion} is older than 3.11`;
  }
  if (candidate.architecture !== hostArchitecture) {
    return `Python architecture ${candidate.architecture} does not match host architecture ${hostArchitecture}`;
  }
  return undefined;
}

function compareCapabilities(left: SidecarProbe, right: SidecarProbe): number {
  const versionOrder = compareVersions(right.pythonVersion, left.pythonVersion);
  return (
    versionOrder ||
    normalizeWindowsPath(left.executable)
      .toLowerCase()
      .localeCompare(normalizeWindowsPath(right.executable).toLowerCase())
  );
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

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
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

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length && expected.every((key) => key in value)
  );
}

function sameStringSet(
  actual: readonly unknown[],
  expected: readonly string[],
): boolean {
  return (
    actual.length === expected.length &&
    expected.every((value) => actual.includes(value))
  );
}

class SidecarOperationError extends Error {}

function originalError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sanitizeDiagnostic(value: string): string {
  return stripControlCharacters(
    value
      .replace(/https?:\/\/[^\s]+/giu, (raw) => {
        try {
          const url = new URL(raw);
          return `${url.origin}${url.pathname}${url.search ? "?[REDACTED]" : ""}`;
        } catch {
          return "[URL omitted]";
        }
      })
      .replace(
        /\b(authorization|proxy-authorization|cookie|set-cookie)\s*:\s*[^\r\n]*/giu,
        "$1: [REDACTED]",
      )
      .replace(
        /\b(api[_-]?key|token|secret|password|cookie|authorization)\s*[:=]\s*[^\s,;]+/giu,
        "$1=[REDACTED]",
      ),
  ).slice(0, MAX_DIAGNOSTIC_CHARACTERS);
}

function stripControlCharacters(value: string): string {
  return [...value]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || code >= 32;
    })
    .join("")
    .trim();
}
