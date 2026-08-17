import {
  mountReaderSection,
  type MountedReaderSection,
  type ReaderSectionController,
} from "./mountReaderSection";

export const READER_PANE_ID = "reference-for-zotero-related-papers";

export interface ReaderSectionRegistration {
  paneID: string;
  pluginID: string;
  header: {
    l10nID: string;
    icon: string;
  };
  sidenav: {
    l10nID: string;
    icon: string;
  };
  sectionButtons: readonly {
    type: string;
    icon: string;
    l10nID: string;
    onClick(): void;
  }[];
  onInit(context: {
    tabType: string;
    setEnabled(enabled: boolean): void;
  }): void;
  onRender(context: {
    body: HTMLElement;
    item: { id: number };
    tabType: string;
    setEnabled(enabled: boolean): void;
  }): void;
  onItemChange(context: {
    body: HTMLElement;
    item: { id: number };
    tabType: string;
    setEnabled(enabled: boolean): void;
  }): void;
  onDestroy(context: { body: HTMLElement }): void;
}

export interface ItemPaneManagerPort {
  registerSection(registration: ReaderSectionRegistration): string | false;
  unregisterSection(paneID: string): void;
}

export interface ReaderControllerFactory {
  create(input: {
    attachmentItemID: number;
    body: HTMLElement;
  }): ReaderSectionController & { dispose?(): void };
}

interface ActiveSection {
  mounted: MountedReaderSection;
  controller: ReaderSectionController & { dispose?(): void };
}

export function registerReaderSection(options: {
  itemPaneManager: ItemPaneManagerPort;
  pluginID: string;
  localeNamespace: string;
  controllerFactory: ReaderControllerFactory;
  openPreferences(): void;
}): () => void {
  const {
    itemPaneManager,
    pluginID,
    localeNamespace,
    controllerFactory,
    openPreferences,
  } = options;
  const activeSections = new Map<HTMLElement, ActiveSection>();

  const destroyBody = (body: HTMLElement): void => {
    const active = activeSections.get(body);
    if (!active) return;
    activeSections.delete(body);
    active.mounted.destroy();
    active.controller.dispose?.();
  };

  const renderBody = (
    body: HTMLElement,
    item: { id: number },
    tabType: string,
    setEnabled: (enabled: boolean) => void,
  ): void => {
    destroyBody(body);
    const enabled = tabType === "reader";
    setEnabled(enabled);
    if (!enabled) return;
    const controller = controllerFactory.create({
      attachmentItemID: item.id,
      body,
    });
    activeSections.set(body, {
      mounted: mountReaderSection({ body, controller }),
      controller,
    });
  };

  const registeredPaneKey = itemPaneManager.registerSection({
    paneID: READER_PANE_ID,
    pluginID,
    header: {
      l10nID: `${localeNamespace}-reference-for-zotero-section-header`,
      icon: "chrome://referenceforzotero/content/icons/related-papers.svg",
    },
    sidenav: {
      l10nID: `${localeNamespace}-reference-for-zotero-section-sidenav`,
      icon: "chrome://referenceforzotero/content/icons/related-papers.svg",
    },
    sectionButtons: [
      {
        type: "open-preferences",
        icon: "chrome://referenceforzotero/content/icons/reader-settings.svg",
        l10nID: `${localeNamespace}-reference-for-zotero-section-settings`,
        onClick: openPreferences,
      },
    ],
    onInit({ tabType, setEnabled }) {
      setEnabled(tabType === "reader");
    },
    onRender({ body, item, tabType, setEnabled }) {
      renderBody(body, item, tabType, setEnabled);
    },
    onItemChange({ body, item, tabType, setEnabled }) {
      renderBody(body, item, tabType, setEnabled);
    },
    onDestroy({ body }) {
      destroyBody(body);
    },
  });
  if (!registeredPaneKey) {
    throw new Error("Failed to register the Related Papers Reader section");
  }

  return () => {
    for (const body of [...activeSections.keys()]) destroyBody(body);
    itemPaneManager.unregisterSection(registeredPaneKey);
  };
}
