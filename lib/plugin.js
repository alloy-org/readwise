import fetch from "isomorphic-fetch"

// --------------------------------------------------------------------------------------
// Latest AN docs https://www.amplenote.com/help/developing_amplenote_plugins
// Get Readwise API key from https://readwise.io/access_token
const plugin = {
  // --------------------------------------------------------------------------------------
  _constants: {
    destructive: app => (app["Remove highlights if Readwise stops reporting them (default is true)"] || true),
    highlightBaseTag: app => (app.settings["Base tag (default is 'readwise')"] || "readwise").toLowerCase().replace(/[^a-z0-9\/]/g, "-"),
    recentBookLimit: app => (app.settings["Recent books to grab (default 100)"] || 100),
    noteTitleRegex: (new RegExp("\(R-ID #([0-9]+)\)")),
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

    while (processedCount < this._constants.recentBookLimit(app)) {
      const queryParams = new URLSearchParams();
      if (nextPageCursor) queryParams.append('pageCursor', nextPageCursor);
      if (updatedAfter) queryParams.append('updatedAfter', updatedAfter);

      console.log('Making export api request with params ' + queryParams.toString());
      const response = await fetch('https://readwise.io/api/v2/export/?' + queryParams.toString(), {
        method: "GET",
        headers: { Authorization: `Token ${ app.settings["Readwise API Key"] }` },
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
  async _bookListFromReadwiseApi(app, existingHighlights) {
    let updatedAfter = null;
    let nextPageCursor = null;
    let processedCount = 0;

    while (processedCount < this._constants.recentBookLimit(app)) {
      const queryParams = new URLSearchParams();
      if (nextPageCursor) queryParams.append('pageCursor', nextPageCursor);

      console.log('Making book api request with params ' + queryParams.toString());
      const response = await fetch('https://readwise.io/api/v2/books/?' + queryParams.toString(), {
        method: "GET",
        headers: { Authorization: `Token ${ app.settings["Readwise API Key"] }`, },
      });

      const responseJson = await response.json();
      if (responseJson["results"]) {
        responseJson["results"].forEach(book => {
          console.log("Book: ", book);
          this._writeBook(app, book);
        });
      }

      if (!nextPageCursor) {
        break;
      }
    }
  },

  // --------------------------------------------------------------------------------------
  async _writeHighlight(app, bookAndHighlights) {
    const noteTitle = bookAndHighlights.title;
    const noteHandle = await app.notes.find(noteTitle);
    if (!noteHandle) {
      const newNote = await app.notes.create({ title: noteTitle });
      await app.notes.addTag(newNote, this._constants.highlightBaseTag(app));
    }
    const noteContent = await app.getNoteContent(noteHandle);
    const newContent = noteContent + "\n\n### " + highlight.text;
    await app.setNoteContent(noteHandle, newContent);
  },

  // --------------------------------------------------------------------------------------
  async _bookHighlightsFromNotes(app) {
    const noteHandles = await app.notes.filter({ tag: this._constants.highlightBaseTag(app) });

    // Step one: get all note handles and note contents that match our Readwise base tag
    const bookNotes = noteHandles.map(async noteHandle => (
      noteHandle.name && this.constants.noteTitleRegex(noteHandle.name)
      ? { noteHandle, content: await app.getNoteContent(noteHandle) }
      : null)).filter(n => n);
    console.log("Found ", bookNotes?.length, "notes matching book titles among", noteHandles?.length, "handles in tag");

    // Step two: convert note contents into an array of objects that can be reconciled with Readwise
    return bookNotes.map(bookNoteContent => {
      const c = bookNoteContent.content;
      return {
        user_book_id: c.match(/^Book ID::[\s]?([\d])+/)?.at(1),
        title: c.match(/^Title:[\s]?([^\n]+)/)?.at(1),
        author: c.match(/^Author:[\s]?([^\n]+)/)?.at(1),
        highlights: this._highlightsFromNoteContent(c)
      }
    };
  },

  // --------------------------------------------------------------------------------------
  _highlightsFromNoteContent: noteContent => {
    const highlights = noteContent.matchAll(/^###[\s]?([^\n]+)/g);

    return Array.from(highlights).map(highlightMatch => {
      const nextHeaderIndex = noteContent.slice(highlightMatch.index).search(/^#[#\s]*/);
      const highlightContent = noteContent.slice(highlightMatch.index, nextHeaderIndex > 0 ? nextHeaderIndex : undefined);
      return {
        text: highlightMatch[1],
        note: highlightContent.match(/^Note:[\s]?([^\n]+)/)?.at(1),
        url:  highlightContent.match(/^Readwise URL:[\s]?([^\n]+)/)?.at(1),
      }
    });
  },
};
export default plugin;
