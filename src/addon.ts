import { config } from "../package.json";
import type { DownloadSettingsController } from "./application/download-settings";
import {
  registerReaderSection,
  type ItemPaneManagerPort,
  type ReaderControllerFactory,
} from "./reader/registerReaderSection";

export interface ReferenceForZoteroHandle {
  shutdown(): void;
}

export type ReferenceForZoteroStartOptions = Readonly<{
  factory: ReaderControllerFactory;
  downloadSetup: DownloadSettingsController;
  itemPaneManager?: ItemPaneManagerPort;
}>;

export function startReferenceForZotero({
  factory,
  downloadSetup,
  itemPaneManager = Zotero.ItemPaneManager as unknown as ItemPaneManagerPort,
}: ReferenceForZoteroStartOptions): ReferenceForZoteroHandle {
  const unregister = registerReaderSection({
    itemPaneManager,
    pluginID: config.addonID,
    localeNamespace: config.addonRef,
    controllerFactory: factory,
  });
  void downloadSetup.probeRuntime();
  let active = true;

  return {
    shutdown() {
      if (!active) return;
      active = false;
      unregister();
      downloadSetup.dispose();
    },
  };
}
