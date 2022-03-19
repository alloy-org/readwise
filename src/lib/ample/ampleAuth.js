import AmpleAccount from "./ampleAccount"
import browser from "../browser"
import Environment from "../../config/environment"

const state = {
  login: false,
  logout: false,
};

// --------------------------------------------------------------------------
const sendMessage = message => {
  browser.runtime.sendMessage(message).catch(_error => {
    // On Chrome this can result in a "possible unhandled exception" warning (using a Promise polyfill) because it
    // raises a "no connection to receiver" error when the popup is closed. We don't care if that's the case
  });
};

// --------------------------------------------------------------------------
export const ampleLogin = async () => {
  state.login = true;
  try {
    const redirectURL = await browser.identity.getRedirectURL()

    let authURL = Environment.amplenote.loginURL
    authURL += `?client_id=${ Environment.amplenote.clientID }`
    authURL += "&response_type=code"
    authURL += `&redirect_uri=${ encodeURIComponent(redirectURL) }`
    authURL += `&scope=${ encodeURIComponent(Environment.amplenote.loginScopes) }`

    const url = await browser.identity.launchWebAuthFlow({ url: authURL, interactive: true })
    const code = new URL(url).searchParams.get("code")
    return await AmpleAccount.fromCode(code, redirectURL)
  } finally {
    state.login = false
    sendMessage({ type: "LOGIN_DONE" })
  }
};

// --------------------------------------------------------------------------
export const ampleLogout = async () => {
  state.logout = true
  try {
    const account = await AmpleAccount.load()
    if (!account) return
    await account.destroy()

  } finally {
    state.logout = false
    sendMessage({ type: "LOGOUT_DONE" })
  }
};
