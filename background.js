import syncReadwise from "./src/readwise"
import { browser, sleep, getExtensionOrigin, log, logE } from "src/lib"

// https://developer.chrome.com/docs/extensions/mv3/service_workers/#listeners
browser.commands.onCommand.addListener(async command => {
  // "perform-sync" is bound to Shift-Ctrl-L in manifest.json
  if (command === "perform-sync") {
    await syncReadwise()
  }
})

// https://developer.chrome.com/docs/extensions/mv3/service_workers/#initialization
browser.runtime.onInstalled.addListener(async () => {
  const { auth } = await browser.storage.local.get("auth")

  if (!auth?.success) {
    await browser.tabs.create({ url: oauthURL, active: true })
  }
})

// Test inspired by https://developer.chrome.com/docs/extensions/mv3/intro/mv3-migration/#action-api-unification
chrome.action.onClicked.addListener(tab => { alert(`You clicked this tab ${ tab }`) });
