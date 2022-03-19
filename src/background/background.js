import { browser, sleep, getExtensionOrigin, log, logE } from "../lib"

browser.commands.onCommand.addListener(async command => {
  if (command === "perform-sync") {
    await toggleSidebar()
  }
})
