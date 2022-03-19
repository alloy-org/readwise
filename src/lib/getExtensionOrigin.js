import { browser } from "."

const getExtensionOrigin = () => {
  const buildTarget = process.env.REACT_APP_BUILD_TARGET

  if (buildTarget === "chrome") {
    return `chrome-extension://${ browser.runtime.id }`
  }

  if (buildTarget === "firefox") {
    return browser.runtime.getURL("./").slice(0, -1)
  }

  throw new Error("Unsupported value for REACT_APP_BUILD_TARGET: ", process.env.REACT_APP_BUILD_TARGET)
}

export default getExtensionOrigin;
export const getPopupUrl = () => `${ getExtensionOrigin() }/popup.html`
export const getSidebarUrl = () => `${ getExtensionOrigin() }/sidebar.html`
