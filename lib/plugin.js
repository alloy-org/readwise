import fetch from "isomorphic-fetch"

// --------------------------------------------------------------------------------------
// Latest AN docs https://www.amplenote.com/help/developing_amplenote_plugins
// Get Readwise API key from https://readwise.io/access_token
const plugin = {
  // --------------------------------------------------------------------------------------
  constants: {
    highlightBaseTag: app => (app.settings["Base tag (default is 'readwise')"] || "readwise"),
  },

  // --------------------------------------------------------------------------------------
  insertText: {
    "Insert Readwise highlight": async function(app) {

    }
  },

  // --------------------------------------------------------------------------------------
  // https://www.amplenote.com/help/developing_amplenote_plugins#noteOption
  noteOption: {
    "Sync Readwise": async function(app, noteUUID) {
      const note = await app.notes.find(noteUUID);
      const noteContent = await note.content();
      const result = await this._callOpenAICompletion(app, "reviseContent", [ instruction, noteContent ]);
      const actionIndex = await app.alert(result, {
        actions: [ { icon: "post_add", label: "Insert in note" } ]
      });
      if (actionIndex === 0) {
        note.insertContent(result);
      }
    },
  },

  // --------------------------------------------------------------------------------------
  // Via https://readwise.io/api_deets "Highlight export" section
  async _fetchFromExportApi(updatedAfter= null) {
    let fullData = [];
    let nextPageCursor = null;

    while (true) {
      const queryParams = new URLSearchParams();
      if (nextPageCursor) {
        queryParams.append('pageCursor', nextPageCursor);
      }
      if (updatedAfter) {
        queryParams.append('updatedAfter', updatedAfter);
      }
      console.log('Making export api request with params ' + queryParams.toString());
      const response = await fetch('https://readwise.io/api/v2/export/?' + queryParams.toString(), {
        method: 'GET',
        headers: {
          Authorization: `Token ${token}`,
        },
      });
      const responseJson = await response.json();
      fullData.push(...responseJson['results']);
      nextPageCursor = responseJson['nextPageCursor'];
      if (!nextPageCursor) {
        break;
      }
    }
    return fullData;
  },

  // --------------------------------------------------------------------------------------
  async _highlightNotes(app) {
    const note = await app.notes.find(noteUUID);
    const noteContent = await note.content();


  },
};
export default plugin;
