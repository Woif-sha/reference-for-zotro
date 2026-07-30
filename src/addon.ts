import { config } from "../package.json";
import {
  registerReaderSection,
  type ItemPaneManagerPort,
  type ReaderControllerFactory,
} from "./reader/registerReaderSection";

export interface ReferenceForZoteroHandle {
  shutdown(): void;
}

export function startReferenceForZotero(
  factory: ReaderControllerFactory,
  itemPaneManager: ItemPaneManagerPort = Zotero.ItemPaneManager as unknown as ItemPaneManagerPort,
): ReferenceForZoteroHandle {
  const unregister = registerReaderSection({
    itemPaneManager,
    pluginID: config.addonID,
    controllerFactory: factory,
  });
  let active = true;

  return {
    shutdown() {
      if (!active) return;
      active = false;
      unregister();
    },
  };
}
