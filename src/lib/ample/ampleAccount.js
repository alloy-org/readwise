import browser from "../browser"
import keyBy from "lodash/keyBy"
import jwtDecode from "jwt-decode"
import Environment from "../../config/environment"
import { fetchJson } from "../fetchJson"

// --------------------------------------------------------------------------
// Can be incremented to force a full refresh of the notes list, in cases where
// the format of the stored notes changes in newer versions of the extension
// (since the notes list is partially updated, any changes would otherwise only
// appear in notes changed since updating to the new version).
const CURRENT_NOTES_STORAGE_VERSION = "2";

// --------------------------------------------------------------------------
const STORAGE_KEYS = [
  "ampleAuth",
  "notes",
  "notesLastModified",
  "notesStorageVersion",
  "selectedMode",
  "selectedNoteUUID",
  "selectedSortOrder",
];

// --------------------------------------------------------------------------
const reshapeRemoteNote = (remoteNote: any) => {
  return {
    name: remoteNote.name,
    tags: remoteNote.tags,
    timestamps: remoteNote.timestamps,
    uuid: remoteNote.uuid,
  };
};

// --------------------------------------------------------------------------
export default class AmpleAccount {
  // --------------------------------------------------------------------------
  static load() {
    return browser.storage.local.get(STORAGE_KEYS).then(({ account, ...attributes }: any) => {
      if (!account || Object.keys(account).length == 0) return null;

      const { notesStorageVersion } = attributes;
      if (notesStorageVersion !== CURRENT_NOTES_STORAGE_VERSION) {
        attributes.notes = null;
      }

      return new AmpleAccount(account, attributes);
    });
  }

  // --------------------------------------------------------------------------
  static fromCode = async (code, redirectURL) => {
    const now = Math.round(new Date().getTime() / 1000);

    const response = await fetchJson(Environment.amplenote.tokenEndpoint, {
      method: "POST",
      payload: {
        client_id: Environment.amplenote.clientID,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectURL,
      }});
    if (!response.ok) throw new Error("Failed to log in");

    const result = await response.json();

    const { email, name, sub: accountUUID }: { email: string, name: string, sub: string } = jwtDecode(result["id_token"]);

    const account = new AmpleAccount(
      {
        accessToken: result["access_token"],
        accessTokenExpiresAt: now + parseInt(result["expires_in"], 10),
        accountUUID,
        email,
        name,
        refreshToken: result["refresh_token"],
      },
      {
        notes: null,
        notesLastModified: null,
        notesStorageVersion: CURRENT_NOTES_STORAGE_VERSION,
        selectedMode: null,
        selectedNoteUUID: null,
        selectedSortOrder: null,
      }
    );
    await account.save();

    return account;
  };

  // --------------------------------------------------------------------------
  get email() {
    return this._data?.email;
  }

  // --------------------------------------------------------------------------
  get name() {
    return this._data?.name;
  }

  // --------------------------------------------------------------------------
  constructor(accountData, attributes) {
    this._data = accountData
    this._assignAttributes(attributes)

    this.notes = null
    this.notesLastModified = null
    this.notesStorageVersion = null
    this.selectedMode = null
    this.selectedNoteUUID = null
    this.selectedSortOrder = null
  }

  // --------------------------------------------------------------------------
  async appendNoteContentAction(uuid, contentAction) {
    const response = await this._callApiWithRefresh(`notes/${ uuid }/actions`, {
      body: JSON.stringify(contentAction),
      method: "POST",

    });

    if (response.status !== 204) throw new Error(`Failed to add to note (${ response.status })`);
  }

  // --------------------------------------------------------------------------
  async createImage(uuid, contentType) {
    const response = await this._callApiWithRefresh(
      uuid ? `notes/${ uuid }/images` : "accounts/images",
      {
        body: JSON.stringify({ type: contentType }),
        method: "POST"
      }
    );
    if (response.status !== 201) throw new Error(`Failed to create image (${ response.status })`);

    const { src: imageURL, url: signedUploadURL, uuid: imageUUID } = await response.json();
    return { imageURL, imageUUID, signedUploadURL };
  }

  // --------------------------------------------------------------------------
  async createNote(name, content) {
    const response = await this._callApiWithRefresh("notes", {
      body: JSON.stringify({ content: JSON.stringify(content), name }),
      method: "POST"
    });
    if (response.status !== 201) throw new Error(`Failed to create note (${ response.status })`);

    const note = await response.json();

    return note.uuid;
  }

  // --------------------------------------------------------------------------
  async completeImageUpload(uuid, imageUUID) {
    const response = await this._callApiWithRefresh(`notes/${ uuid }/images/${ imageUUID }`, {
      body: JSON.stringify({ local_uuid: "none" }),
      method: "PUT"
    });
    if (response.status !== 204) throw new Error(`Failed to complete image upload (${ response.status })`);
  }

  // --------------------------------------------------------------------------
  async destroy() {
    await this._logout();
    await browser.storage.local.remove(STORAGE_KEYS);
  }

  // --------------------------------------------------------------------------
  async loadNotes() {
    const partialUpdate = this.notes && this.notesLastModified &&
      this.notesStorageVersion === CURRENT_NOTES_STORAGE_VERSION;

    const response = await this._callApiWithRefresh(
      partialUpdate ? `notes?since=${ this.notesLastModified }` : "notes",
      {
        cache: "no-store",
        headers: { "Cache-Control": "no-store" },
      }
    );

    if (!response.ok) throw new Error(`Failed to load notes (${ response.status })`);

    const lastModified = response.headers.get("Last-Modified");
    const notesLastModified = Math.floor(new Date(lastModified).getTime() / 1000);

    const remoteNotes = await response.json();

    let notes;
    if (partialUpdate) {
      const localNotesByUUID = keyBy(this.notes, note => note.uuid);

      remoteNotes.forEach(remoteNote => {
        if (remoteNote.deleted) {
          delete localNotesByUUID[remoteNote.uuid];
        } else {
          localNotesByUUID[remoteNote.uuid] = reshapeRemoteNote(remoteNote);
        }
      });

      notes = Object.values(localNotesByUUID)
    } else {
      notes = remoteNotes.map(reshapeRemoteNote);
    }

    await this._updateAttributes({
      notes,
      notesLastModified,
      notesStorageVersion: CURRENT_NOTES_STORAGE_VERSION,
    });

    return notes;
  }

  // --------------------------------------------------------------------------
  async save() {
    await browser.storage.local.set({
      ampleAuth: this._data,

      // Attributes
      notes: this.notes,
      notesLastModified: this.notesLastModified,
      notesStorageVersion: this.notesStorageVersion,
      selectedMode: this.selectedMode,
      selectedNoteUUID: this.selectedNoteUUID,
      selectedSortOrder: this.selectedSortOrder,
    });
  }

  // --------------------------------------------------------------------------
  _assignAttributes = attributes => {
    Object.keys(attributes).forEach(key => {
      this[key] = attributes[key];
    });
  };

  // --------------------------------------------------------------------------
  _callApiWithRefresh = async (path, options = {}) => {
    options.headers = {
      "Accept": "application/json",
      "Content-Type": "application/json",
      ...(options.headers || {}),
      "Authorization": `Bearer ${ this._data.accessToken }`
    };

    const url = `${ Environment.amplenote.apiHost }/${ Environment.amplenote.apiVersion }/${ path }`;
    const response = await fetch(url, options);
    if (response.status !== 401) return response;

    const now = Math.round(new Date().getTime() / 1000);

    const refreshResponse = await fetchJson(Environment.amplenote.tokenEndpoint, {
      headers: options.headers,
      method: "POST",
      payload: {
        client_id: Environment.amplenote.clientID,
        grant_type: "refresh_token",
        refresh_token: this._data.refreshToken,
      },
    });

    if (refreshResponse.status === 400) {
      const refreshResult = await refreshResponse.json();
      if (refreshResult.error === "invalid_grant") {
        // The refresh token itself is no longer valid (i.e. we've been force-logged-out)
        alert("You've been logged out");
      }
    }

    if (!refreshResponse.ok) return response;

    const result = await refreshResponse.json();
    const accessToken = result && result["access_token"];
    if (!accessToken) return response;

    this._data.accessToken = accessToken;
    this._data.accessTokenExpiresAt = now + parseInt(result["expires_in"], 10);
    await this.save();

    options.headers["Authorization"] = `Bearer ${ accessToken }`;
    return await fetch(url, options);
  };

  // --------------------------------------------------------------------------
  _logout = async () => {
    await fetchJson(Environment.amplenote.revokeEndpoint, {
      payload: {
        client_id: Environment.amplenote.clientID,
        token: this._data.accessToken,
      },
      method: "POST",
    });

    // We don't really care if this succeeds - it might make more sense for the API to allow a refreshToken to be
    // provided for a more reliable revocation process
  };

  // --------------------------------------------------------------------------
  _updateAttributes = async attributes => {
    this._assignAttributes(attributes);
    await browser.storage.local.set(attributes);
  }
}
