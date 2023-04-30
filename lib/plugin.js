import fetch from "isomorphic-fetch"

// --------------------------------------------------------------------------------------
// Latest AN docs https://www.amplenote.com/help/developing_amplenote_plugins
// Get Readwise API key from https://readwise.io/access_token
const plugin = {
  // --------------------------------------------------------------------------------------
  _constants: {
    destructive: app => (app["Remove highlights if Readwise stops reporting them (default is true)"] || true),
    highlightBaseTag: app => (app.settings["Base tag (default is 'readwise')"] ? this._textToTagName(app.settings["Base tag (default is 'readwise')"]) || "readwise" : "readwise"),
    recentBookLimit: app => (app.settings["Recent books to grab (default 100)"] || 100),
    noteTitleRegex: text => text.match("\(R-ID #([0-9]+)\)"),
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
      const bookHighlights = await this._bookHighlightsFromNotes(app);
      console.log("Found " + bookHighlights.length + " book highlights");
      const readwiseHighlights = await this._fetchNewFromReadwiseExportApi(app, bookHighlights);
      await this._syncExistingAndReadwise(app, bookHighlights, readwiseHighlights);
      app.alert("Finished syncing Readwise");
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
  async _syncExistingAndReadwise(app, bookHighlights, readwiseHighlights) {
    readwiseHighlights.forEach(highlight => {
      let note = bookHighlights.find(book => book.user_book_id === highlight.user_book_id);
      if (!note) {
        const noteTitle = `Highlights from "${ highlight.title }" by ${ highlight.author } (R-ID #${ highlight.id })`
        const baseTag = this._constants.highlightBaseTag(app);
        const tags = [ highlight.category ? `${ baseTag }/${ this._textToTagName(highlight.category) }` : baseTag ];

        app.createNote(noteTitle, tags);
      }
    });
  },

  // --------------------------------------------------------------------------------------
  async _writeHighlight(app, bookAndHighlights) {
    const noteTitle = bookAndHighlights.title;
    // const noteHandle = await app.notes.find(noteTitle);
    // if (!noteHandle) {
    //   const newNote = await app.notes.create({ title: noteTitle });
    //   await app.notes.addTag(newNote, this._constants.highlightBaseTag(app));
    // }
    // const noteContent = await app.getNoteContent(noteHandle);
    // const newContent = noteContent + "\n\n### " + highlight.text;
    // await app.setNoteContent(noteHandle, newContent);
  },

  // --------------------------------------------------------------------------------------
  async _bookHighlightsFromNotes(app) {
    const noteHandles = await app.notes.filter({ tag: this._constants.highlightBaseTag(app) });

    // Step one: get all note handles and note contents that match our Readwise base tag
    const bookNotes = noteHandles.map(noteHandle => (
      noteHandle.name && this._constants.noteTitleRegex(noteHandle.name)
      ? { name: noteHandle.name, content: app.getNoteContent(noteHandle), uuid: noteHandle.uuid }
      : null)).filter(n => n);
    console.log("Found ", bookNotes?.length, "notes matching book titles among", noteHandles?.length, "handles in tag");

    // Step two: convert note contents into an array of objects that can be reconciled with Readwise
    const notes = bookNotes.map(async bookNoteContent => {
      const c = await bookNoteContent.content;
      return {
        author: c.match(/^Author:[\s]?([^\n]+)/)?.at(1),
        title: c.match(/^Title:[\s]?([^\n]+)/)?.at(1),
        highlights: this._highlightsFromNoteContent(c),
        note_name: bookNoteContent.name,
        note_uuid: bookNoteContent.uuid,
        user_book_id: c.match(/^Book ID::[\s]?([\d])+/)?.at(1)
      }
    });

    return notes;
  },

  // --------------------------------------------------------------------------------------
  _textToTagName: text => {
    if (!text) return null;
    return text.toLowerCase().trim().replace(/[^a-z0-9\/]/g, "-");
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
