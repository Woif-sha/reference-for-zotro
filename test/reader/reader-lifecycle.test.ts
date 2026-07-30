import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import {
  registerReaderSection,
  type ItemPaneManagerPort,
  type ReaderControllerFactory,
  type ReaderSectionRegistration,
} from "../../src/reader/registerReaderSection";
import type { ReaderSectionState } from "../../src/reader/mountReaderSection";

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
  const destroyed: number[] = [];
  const state: ReaderSectionState = {
    activeTab: "references",
    status: "ready",
    references: [],
    citingPapers: [],
    citingPaperLimit: 10,
    citingPapersLoaded: 10,
  };
  const factory: ReaderControllerFactory = {
    create({ attachmentItemID }) {
      return {
        getState: () => state,
        subscribe: () => () => {},
        selectTab() {},
        setCitationLimit() {},
        selectPaper() {},
        refresh() {},
        openPrimaryResult() {},
        dispose: () => destroyed.push(attachmentItemID),
      };
    },
  };

  const unregister = registerReaderSection({
    itemPaneManager: manager,
    pluginID: "referenceforzotero@woif-sha.github.io",
    controllerFactory: factory,
  });
  assert.ok(registration);

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
  assert.match(body.textContent ?? "", /Related Papers/);

  registration.onItemChange({
    body,
    item: { id: 43 },
    tabType: "reader",
    setEnabled: () => {},
  });
  assert.deepEqual(destroyed, [42]);

  registration.onDestroy({ body });
  unregister();
  assert.deepEqual(destroyed, [42, 43]);
  assert.deepEqual(unregistered, ["registered-pane-key"]);
});
