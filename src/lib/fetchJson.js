// --------------------------------------------------------------------------
// Defaults to use method GET and Content-Type `application/json`
//
// Example GET
// xhrFetch(CODE_REACTIONS_FETCH_PATH, { payload: { code_line_id: this.props.codeLineId }}))
//   .then(response => response.json()).then(json => ...)
//
// Example POST
// xhrFetch(toggleEmojiPath, {
//     method: "POST",
//     body: JSON.stringify({
//       commit_comment_id: commentId,
//       comment_reaction_id: reactionId,
//     })
//   })
//  .then(response => response.json()).then(json => ...)
const xhrFetch = (endpoint, attrs) => {
  // Disallow all requests to other origins - this is intended _only_ for calls to the rails app

  let init = { ...(attrs || {}), mode: "same-origin" }
  if (!init.headers) init.headers = {}
  if (!init.headers["Content-Type"]) init.headers["Content-Type"] = "application/json";
  init.headers["X_REQUESTED_WITH"] = "XMLHttpRequest"

  const method = (init.method || "GET").toUpperCase()
  if (init.payload) {
    if (method === "GET") {
      // Eventually perhaps we'll teach GET request to work with payload. For now GET callers are responsible for forming their own URL
      // endpoint = GitClear.Utility.extendUrlWithParameters(endpoint, init.payload);
    } else {
      init.body = JSON.stringify(init.payload)
    }
  }
  if (method !== "GET" && method !== "HEAD") {
    init.headers = { ...init.headers, "X-CSRF-Token": csrfToken() }
  }

  return fetch(endpoint, init)
};
export default xhrFetch

// --------------------------------------------------------------------------
// See https://medium.com/@xpl/javascript-deriving-from-error-properly-8d2f8f315801 for the necessity of all this junk
// tl;dr: Most transpilers create inconsistent notions of what an instance of a class *is* - this forces the notion to
// be consistent, which plays a lot nicer with React / Sentry error reporting.
class ResponseError extends Error {
  constructor (response) {
    const message = `Encountered ${ response.status } error from response`
    super (message)
    this.constructor = ResponseError
    this.__proto__ = ResponseError.prototype
    this.message = message
    this.status = response.status
    this.body = response.body
  }
}

// --------------------------------------------------------------------------
// Example:
//
// fetchJson(this.props.markFixReleasedPath, {
//   method: "POST",
//   payload: { defect_key: defectParams.defectKey }
// }).then(json => {
//   if (json.responseEm === "response_success") console.log("Cool");
// });
export const fetchJson = (endpoint, attrs) => {
  attrs = attrs || {}
  if (!attrs.headers) attrs.headers = {}
  attrs.headers["Accept"] = "application/json"
  attrs.headers["Content-Type"] = "application/json"

  return xhrFetch(endpoint, attrs).then(response => {
    if (response.ok) {
      return response.json()
    } else {
      throw new ResponseError(response)
    }
  });
};
