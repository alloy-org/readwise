import AmplenoteAccount from "./amplenoteAccount"
import ext from "./ext"
import Environment from "../config/environment"

// --------------------------------------------------------------------------
// Since this background script performs some long-lived actions, we'd like to
// be able to reflect the state of the background script in the popup when it
// opens, even if it was closed after initiating some background script action
const state = {
  clipPage: false,
  login: false,
  logout: false,
};

// --------------------------------------------------------------------------
const sendMessage = message => {
  ext.runtime.sendMessage(message).catch(_error => {
    // On Chrome this can result in a "possible unhandled exception" warning (using a Promise polyfill) because it
    // raises a "no connection to receiver" error when the popup is closed. We don't care if that's the case
  });
};

// --------------------------------------------------------------------------
const login = async () => {
  state.login = true;
  try {
    const redirectURL = await ext.identity.getRedirectURL();

    let authURL = Environment.amplenote.loginURL;
    authURL += `?client_id=${ Environment.amplenote.clientID }`;
    authURL += "&response_type=code";
    authURL += `&redirect_uri=${ encodeURIComponent(redirectURL) }`;
    authURL += `&scope=${ encodeURIComponent(Environment.amplenote.loginScopes) }`;

    const url = await ext.identity.launchWebAuthFlow({ url: authURL, interactive: true });
    const code = new URL(url).searchParams.get("code");
    return await AmplenoteAccount.fromCode(code, redirectURL);
  } finally {
    state.login = false;
    sendMessage({ type: "LOGIN_DONE" });
  }
};

// --------------------------------------------------------------------------
const logout = async () => {
  state.logout = true;
  try {
    const account = await AmplenoteAccount.load();
    if (!account) return;

    await account.destroy();

  } finally {
    state.logout = false;
    sendMessage({ type: "LOGOUT_DONE" });
  }
};
