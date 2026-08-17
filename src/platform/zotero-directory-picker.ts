import { FilePickerHelper } from "zotero-plugin-toolkit";

export async function chooseZoteroDirectory(options: {
  title: string;
  current?: string;
  owner?: Window;
}): Promise<string | undefined> {
  const selected = await new FilePickerHelper(
    options.title,
    "folder",
    undefined,
    undefined,
    options.owner ?? Zotero.getMainWindow(),
    undefined,
    options.current,
  ).open();
  return selected || undefined;
}
