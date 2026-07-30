var chromeHandle;

function install(data, reason) {}

async function startup({ resourceURI, rootURI }, reason) {
  await Zotero.initializationPromise;
  rootURI ||= resourceURI.spec;

  const addonManagerStartup = Components.classes[
    "@mozilla.org/addons/addon-manager-startup;1"
  ].getService(Components.interfaces.amIAddonManagerStartup);
  const manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = addonManagerStartup.registerChrome(manifestURI, [
    ["content", "__addonRef__", rootURI + "chrome/content/"],
  ]);

  const context = { rootURI };
  context._globalThis = context;
  Services.scriptloader.loadSubScript(
    `${rootURI}chrome/content/scripts/__addonRef__.js`,
    context,
  );
}

async function onMainWindowLoad({ window }, reason) {
  await Zotero.__addonInstance__?.hooks.onMainWindowLoad(window);
}

async function onMainWindowUnload({ window }, reason) {
  await Zotero.__addonInstance__?.hooks.onMainWindowUnload(window);
}

function shutdown(data, reason) {
  if (reason === APP_SHUTDOWN) return;
  Zotero.__addonInstance__?.hooks.onShutdown();
  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }
}

function uninstall(data, reason) {}
