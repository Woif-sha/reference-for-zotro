import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

import { startReferenceForZotero } from "../../src/addon";
import type { DownloadSettingsController } from "../../src/application/download-settings";
import {
  registerReaderSection,
  type ItemPaneManagerPort,
  type ReaderControllerFactory,
  type ReaderSectionRegistration,
} from "../../src/reader/registerReaderSection";
import type { ReaderSectionState } from "../../src/reader/mountReaderSection";

test("Reader registration completes before the sidecar probe settles", () => {
  const events: string[] = [];
  let resolveProbe!: () => void;
  const itemPaneManager: ItemPaneManagerPort = {
    registerSection() {
      events.push("register");
      return "reader-section";
    },
    unregisterSection() {
      events.push("unregister");
    },
  };
  const downloadSetup: DownloadSettingsController = {
    getState() {
      throw new Error("State is not read at the startup boundary");
    },
    subscribe() {
      return () => {};
    },
    async changeDownloadDestination() {},
    resetDownloadDestination() {},
    probeRuntime() {
      events.push("probe");
      return new Promise<void>((resolve) => {
        resolveProbe = resolve;
      });
    },
    dispose() {
      events.push("dispose-download-setup");
    },
  };
  const factory: ReaderControllerFactory = {
    create() {
      throw new Error("Reader rendering is outside this startup test");
    },
  };

  const handle = startReferenceForZotero({
    factory,
    itemPaneManager,
    downloadSetup,
  });

  assert.deepEqual(events, ["register", "probe"]);
  handle.shutdown();
  assert.deepEqual(events, [
    "register",
    "probe",
    "unregister",
    "dispose-download-setup",
  ]);
  resolveProbe();
});

test("Reader lifecycle enables only Reader tabs and removes section work on destroy and shutdown", () => {
  let registration: ReaderSectionRegistration | undefined;
  const unregistered: string[] = [];
  const manager: ItemPaneManagerPort = {
    registerSection(next) {
      registration = next;
      return "registered-pane-key";
    },
    unregisterSection(paneID) {
      unregistered.push(paneID);
    },
  };
  const created: number[] = [];
  const destroyed: number[] = [];
  const state: ReaderSectionState = {
    activeTab: "references",
    status: "ready",
    references: [],
    citingPapers: [],
    citingPaperLimit: 10,
    citingPapersLoaded: 10,
    citingPapersStatus: { status: "ready" },
    recommendation: { status: "not-analyzed" },
    downloadSelection: [],
    paperDownloads: [],
    downloadInProgress: false,
    downloadAvailable: true,
  };
  const factory: ReaderControllerFactory = {
    create({ attachmentItemID }) {
      created.push(attachmentItemID);
      return {
        setPaperDownloadSelected() {},
        setTabDownloadSelected() {},
        async downloadSelected() {},
        openDownloadedFolder() {},
        openReferenceURL() {},
        getState: () => state,
        subscribe: () => () => {},
        selectTab() {},
        setCitationLimit() {},
        selectPaper() {},
        refresh() {},
        openPaper() {},
        performPaperAction() {},
        dispose: () => destroyed.push(attachmentItemID),
      };
    },
  };

  const unregister = registerReaderSection({
    itemPaneManager: manager,
    pluginID: "referenceforzotero@woif-sha.github.io",
    localeNamespace: "referenceforzotero",
    controllerFactory: factory,
  });
  assert.ok(registration);
  assert.equal(
    registration.header.l10nID,
    "referenceforzotero-reference-for-zotero-section-header",
  );
  assert.equal(
    registration.sidenav.l10nID,
    "referenceforzotero-reference-for-zotero-section-sidenav",
  );

  const enabled: boolean[] = [];
  registration.onInit({
    tabType: "library",
    setEnabled: (value) => enabled.push(value),
  });
  registration.onInit({
    tabType: "reader",
    setEnabled: (value) => enabled.push(value),
  });
  assert.deepEqual(enabled, [false, true]);

  const dom = new JSDOM("<!doctype html><body><section></section></body>");
  const body = dom.window.document.querySelector(
    "section",
  ) as HTMLElement | null;
  assert.ok(body);
  registration.onRender({
    body,
    item: { id: 42 },
    tabType: "reader",
    setEnabled: () => {},
  });
  assert.deepEqual(created, [42]);
  assert.match(body.textContent ?? "", /MinerU MD/);

  const itemChangeEnabled: boolean[] = [];
  registration.onItemChange({
    body,
    item: { id: 43 },
    tabType: "reader",
    setEnabled: (value) => itemChangeEnabled.push(value),
  });
  assert.deepEqual(itemChangeEnabled, [true]);
  assert.deepEqual(created, [42, 43]);
  assert.deepEqual(destroyed, [42]);
  assert.match(body.textContent ?? "", /MinerU MD/);

  registration.onDestroy({ body });
  unregister();
  assert.deepEqual(destroyed, [42, 43]);
  assert.deepEqual(unregistered, ["registered-pane-key"]);
});

test("Reader section Fluent messages localize control attributes without replacing their contents", () => {
  for (const locale of ["en-US", "zh-CN"]) {
    const fluent = readFileSync(
      new URL(`../../addon/locale/${locale}/addon.ftl`, import.meta.url),
      "utf8",
    );
    assert.match(
      fluent,
      /reference-for-zotero-section-header\s*=\s*\r?\n\s+\.label\s*=\s*\S+/u,
    );
    assert.match(
      fluent,
      /reference-for-zotero-section-sidenav\s*=\s*\r?\n\s+\.tooltiptext\s*=\s*\S+/u,
    );
  }
});
