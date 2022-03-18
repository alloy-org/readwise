// --------------------------------------------------------------------------
const Environment = {
  amplenote: {
    clientID: __API_CLIENT_ID__,
    apiHost: "https://api.amplenote.com",
    apiVersion: "v2",
    loginURL: "https://login.amplenote.com/login",
    loginScopes: "notes:create notes:create-content-action notes:create-image notes:list",
  },
  readwise: {
    accessTokenURL: "https://readwise.io/access_token",
  }
};

if (__DEV__) {
  Environment.amplenote.apiHost = "http://api.localhost.test:5000";
  Environment.amplenote.loginURL = "http://login.localhost.test:5000/login";
}

Environment.amplenote.revokeEndpoint = `${ Environment.amplenote.apiHost }/oauth/revoke`;
Environment.amplenote.tokenEndpoint = `${ Environment.amplenote.apiHost }/oauth/token`;

// --------------------------------------------------------------------------
export default Environment;
