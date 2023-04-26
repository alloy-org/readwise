import fetch from "isomorphic-fetch"

// --------------------------------------------------------------------------------------
// Latest AN docs https://www.amplenote.com/help/developing_amplenote_plugins
// Get Readwise API key from https://readwise.io/access_token
const plugin = {
  // --------------------------------------------------------------------------------------
  constants: {
    highlightBaseTag: app => (app.settings["Base tag (default is 'readwise')"] || "readwise").toLowerCase().replace(/[^a-z0-9]/g, "-"),
    recentBookLimit: app => (app.settings["Recent books to grab (default 100)"] || 100),
  },

  // --------------------------------------------------------------------------------------
  insertText: {
    "Insert Readwise highlight": async function(app) {
      const actionIndex = await app.alert(result, {
        actions: [ { icon: "post_add", label: "Insert in note" } ]
      });
      if (actionIndex === 0) {
        // note.insertContent(result);
      }
    }
  },

  // --------------------------------------------------------------------------------------
  // https://www.amplenote.com/help/developing_amplenote_plugins#noteOption
  noteOption: {
    "Sync Readwise": async function(app, noteUUID) {
      console.log("Syncing Readwise highlights...");
      const existingHighlights = await this._existingHighlightsFromNotes(app);
      console.log("Found " + existingHighlights.length + " existing highlights");
      const readwiseHighlights = await this._fetchNewFromReadwiseExportApi(app, existingHighlights)
      const note = await app.notes.find(noteUUID);
      const noteContent = await note.content();
    },
  },

  // --------------------------------------------------------------------------------------
  // Via https://readwise.io/api_deets "Highlight export" section
  // Returns objects from the `results` array https://public.amplenote.com/9rj3D65n8nrQPGioxUgrzYVo
  async _fetchNewFromReadwiseExportApi(app, existingHighlights) {
    let updatedAfter = null;
    let fullData = [];
    let nextPageCursor = null;
    let processedCount = 0;

    if (existingHighlights?.length) {
      // Todo: Is this sort adequate, if updated is a string?
      updatedAfter = existingHighlights.map(highlight => highlight["updated"]).sort().pop();
    }

    while (processedCount < this.constants.recentBookLimit(app)) {
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
          Authorization: `Token ${ app.settings["Readwise API Key"] }`,
        },
      });

      const responseJson = await response.json();
      fullData.push(...responseJson["results"]);
      processedCount = fullData.length;
      nextPageCursor = responseJson["nextPageCursor"];
      if (!nextPageCursor) {
        break;
      }
    }
    return fullData;
  },

  // --------------------------------------------------------------------------------------
  async _existingHighlightsFromNotes(app) {
    const noteHandles = await app.notes.filter({ tag: this.constants.highlightBaseTag(app) });

    // Step one: get all note handles and note contents that match our Readwise base tag
    const noteContents = noteHandles.map(async noteHandle => ({
      noteHandle,
      content: await app.getNoteContent(noteHandle),
    }));
    console.log("Found ", noteContents?.length, "noteContents");

    // Step two: convert note contents into an array of objects that can be reconciled with Readwise

    return noteContents;
  },
};
export default plugin;
