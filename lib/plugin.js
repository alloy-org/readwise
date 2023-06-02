const plugin = {
  constants: {
    dashboardTitle: "Readwise Book List",
    defaultBaseTag: "library",
    defaultHighlightSort: "newest",
    maxBooksFetchedPerInvoke: 3, // Todo: Change back to 100 when publishing
    maxHighlightLimit: 5000,
    rateLimit: 20, // Max requests per minute (20 is Readwise limit for Books and Highlights APIs)
    readwiseBookDetailURL: bookId => `https://readwise.io/api/v2/books/${ bookId }`,
    readwiseBookIndexURL: "https://readwise.io/api/v2/books",
    readwiseHighlightsIndexURL: "https://readwise.io/api/v2/highlights",
    settingDateFormat: "Date format (default is 'en-US')",
    settingDiscardedName: "Import discarded highlights (\"true\" or \"false\". Default: false)",
    settingSortOrderName: "Highlight sort order (\"newest\" or \"oldest\". Default: newest)",
    settingTagName: "Base tag for Readwise notes (Default: \"library\")",
    updateStringPreface: "- Highlights updated at: ",
  },

  _lastRequestTime: null,
  _requestsCount: 0,

  noteOption: {
    /*******************************************************************************************
     * Fetches all books found in Readwise. Creates a note per book.
     */
    "Sync all": async function (app, noteUUID) {
      try {
        // The root note of the Readwise imports
        const dashboardNote = await app.notes.find(noteUUID);
        let bookCount = 0;

        // Fetch a book, create its note and add its highlights
        for await (const book of this._readwiseFetchBooks(app)) {
          if (bookCount > this.constants.maxBooksFetchedPerInvoke) {
            // Hard code an upper limit to the amount of books we process
            break;
          }

          const bookNote = await this._ensureBookNote(app, book, dashboardNote);
          this._syncBookHighlights(app, bookNote, book.id, book);
          bookCount += 1;
        }

        await app.alert("✅ All books fetched successfully!")

      } catch (error) {
        await app.alert(String(error));
      }
    },

    /*******************************************************************************************
     * Syncs newer highlights for an individual book.
     * Fails if the note title doesn't match the required template.
     */
    "Sync this book": async function (app, noteUUID) {
      try {
        const currentNote = await app.notes.find(noteUUID);
        const noteTitle = currentNote.name;

        // Check if the note title is of the format "Readwise: {book title} {book id}"
        const titleRegex = /ID\s?#([\d]+)/;
        const match = noteTitle.match(titleRegex);
        if (!match) {
          throw new Error("The note title format is incorrect. It should contain an 'ID' designator, like 'ID: #123', in the title");
        }

        // Import all (new) highlights from the book
        const bookId = match[1];
        const url = new URL(`${ this.constants.readwiseBookIndexURL }/`);
        const requestPage = await this._readwisePaginateRequest(app, url);
        await this._syncBookHighlights(app, currentNote, bookId);

        await app.alert("✅ Book highlights fetched successfully!")
      } catch (error) {
        await app.alert(String(error));
      }
    },
  },

  /*******************************************************************************************
   * Sync highlights for a book into the note provided. This method does all of the propagation from
   * Readwise Highlight object to list of highlights in a note
   */
  _syncBookHighlights: async function (app, bookNote, readwiseBookID, readwiseBook = null) {
    const lastUpdatedAt = await this._getLastUpdatedTimeFromNote(app, bookNote);

    // Import all (new) highlights from the book
    let highlightCount = 0;
    const noteContent = await bookNote.content();

    if (!noteContent.includes("# Summary")) {
      bookNote.insertContent("# Summary\n");
    }

    if (!readwiseBook) {
      readwiseBook = await this._readwiseMakeRequest(app, this.constants.readwiseBookDetailURL(readwiseBookID));
    }

    const summaryContent = this._bookNotePrefaceContentFromReadwiseBook(app, readwiseBook, bookNote);
    bookNote.replaceContent(summaryContent, this._sectionFromHeadingText("Summary"));
    const sortOrder = app.settings[this.constants.settingSortOrderName] || this.constants.defaultHighlightSort;

    if (!noteContent.includes("# Highlights")) {
      bookNote.insertContent("\n# Highlights\n", { atEnd: true });
    }

    // Example of Highlight object: https://images.amplenote.com/d1f0c1ce-e3d4-11ed-9bea-fe0bc8306505/cfb6feb7-f3fd-4ab1-bcfa-2f7457c5923e.jpg
    const highlightsList = [];
    for await (const highlight of this._readwiseGetAllHighlightsForBook(app, readwiseBookID, lastUpdatedAt)) {
      if (highlightCount > this.constants.maxHighlightLimit) break;
      if (noteContent.includes(highlight.text)) continue;
      if (highlight.is_discard && app.settings[this.constants.settingDiscardedName] !== "true") continue;

      let highlightContent = `> ### ${ highlight.text }\n\n`;
      if (highlight.note) {
        highlightContent += `\n- **Note**: ${ highlight.note }\n`;
      }
      if (highlight.location || highlight.highlighted_at) {
        const details = []
        if (highlight.location) highlightContent += `**Location**: [${ highlight.location }](https://readwise.io/bookreview/${ highlight.id })\n`;
        if (highlight.highlighted_at) highlightContent += `**Highlighted at**: ${ this._localeDateFromIsoDate(app, highlight.highlighted_at) }\n`;
        if (highlight.color) highlightContent += `**Highlight color**: ${ highlight.color }\n`;
      }

      // WBH has observed as of June 2023 that Readwise returns highlights in order of newest, so appending each
      // has the effect of putting the oldest highlights at the top of the note.
      if (sortOrder === "newest") {
        highlightsList.push(highlightContent);
      } else {
        highlightsList.unshift(highlightContent);
      }
      highlightCount++;
    }

    await bookNote.replaceContent(highlightsList.join("\n") + "\n\n", this._sectionFromHeadingText("Highlights"));

    let existingContent = "";
    if (!noteContent.includes("Sync History")) {
      bookNote.insertContent("\n# Sync History\n", { atEnd: true });
    } else {
      const match = noteContent.match(/#\sSync\sHistory\n([\s\S]+)$/m);
      existingContent = match ? match[1] : "";
    }

    await bookNote.replaceContent(`${ this.constants.updateStringPreface }${ this._localeDateFromIsoDate(app, new Date()) }\n` + existingContent,
      this._sectionFromHeadingText("Sync History"));
  },

  /*******************************************************************************************
   * Returns the note handle of a highlight note given a Readwise Book object
   * Will return an existing note if a note title is matched, or will create a new one otherwise.
   * Will add a new link to the Readwise Dashboard if the note is created.
   *
   * Params
   * readwiseBook: a Readwise Book object (see "Books LIST" on https://readwise.io/api_deets or https://public.amplenote.com/9rj3D65n8nrQPGioxUgrzYVo)
   */
  async _ensureBookNote(app, readwiseBook, dashboardNote) {
    console.log(`_ensureBookNote(${ app }, ${ readwiseBook.title }, ${ dashboardNote })`);
    const baseTag = app.settings[this.constants.settingTagName] || this.constants.defaultBaseTag;

    // First, check if the note for this book exists
    const readwiseNotes = await app.filterNotes({ tag: baseTag });
    const bookRegex = new RegExp(`ID\\s?#${ readwiseBook.id }`);
    const searchResults = readwiseNotes.filter(item => bookRegex.test(item.name));
    let bookNote = null;
    if (searchResults.length === 0) {
      const noteTitle = this._noteTitleFromBook(readwiseBook);

      // Create the note if it doesn't exist
      bookNote = await app.notes.create(noteTitle, [ `${ baseTag }/${ this._textToTagName(readwiseBook.category) }`,
        `${ baseTag }/${ this._textToTagName(readwiseBook.author) }` ]);
      const dashboardNoteContents = await dashboardNote.content();
      if (dashboardNoteContents.includes(readwiseBook.title)) {
        return bookNote; // Already inserted this book into our dashboard ToC
      }

      // Recreate the table of books with the new entry as the first
      let existingTable = "";
      if (!dashboardNoteContents.includes(this.constants.dashboardTitle)) {
        // Add a header to the dashboard note if it doesn't exist
        dashboardNote.insertContent(`# ${ this.constants.dashboardTitle }\n`)
      } else {
        // In order to replace the table, we need to remove the preamble(s) to the existing table(s)
        existingTable = this._sectionContent(dashboardNoteContents, "Readwise Book List");
        [ /\|\s?\*\*Cover\*\*\s?\|\s?\*\*Book Title\*\*\s?\|\s?\*\*Author\*\*\s?\|\s?\*\*Category\*\*\s?\|\s?\*\*Source\*\*\s?\|\s?\*\*Highlight Date\*\*\s?\|\s?\*\*Other Details\*\*\s?\|\n/gm,
          /\|-\|-\|-\|-\|-\|-\|-\|\n/gm,
          /\| \| \| \| \| \| \| \|\n/gm ].forEach(removeString => {
          existingTable = existingTable.replace(removeString, "").trim();
        });
      }

      const tablePreambleContent = `| **Cover** | **Book Title** | **Author** | **Category** | **Source** | **Highlight Date** | **Other Details** |\n` +
        `|-|-|-|-|-|-|-|\n`;
      const bookRowContent = `| ![${ readwiseBook.title } cover](${ readwiseBook.cover_image_url }) ` +
        `| [${ readwiseBook.title }](https://www.amplenote.com/notes/${ bookNote.uuid }) ` +
        `| ${ readwiseBook.author } ` +
        `| ${ readwiseBook.category } ` +
        `| ${ readwiseBook.source ? (readwiseBook.source_url ? `[${ readwiseBook.source }](${ readwiseBook.source_url })` : readwiseBook.source) : "" } ` +
        `| ${ this._localeDateFromIsoDate(app, readwiseBook.last_highlight_at) } ` +
        `| [Readwise link](https://readwise.io/bookreview/${ readwiseBook.id }) |\n`;
      const readwiseTableContent = tablePreambleContent + bookRowContent + existingTable + "\n";

      const replaceSection = this._sectionFromHeadingText(this.constants.dashboardTitle);
      await dashboardNote.replaceContent(readwiseTableContent, replaceSection);
    } else {
      const newNoteUUID = searchResults[0].uuid;
      bookNote = await app.notes.find(newNoteUUID);
    }
    return bookNote;
  },

  /*******************************************************************************************
   * Returns the title of the note in Amplenote, given a book object
   */
  _noteTitleFromBook(book) {
    return `${ book.title } by ${ book.author } Highlights (ID #${ book.id })`;
  },

  /*******************************************************************************************/
  _sectionFromHeadingText(headingText) {
    return { section: { heading: { text: headingText }}};
  },

  /*******************************************************************************************
   * Return all of the markdown within a section that begins with `sectionHeadingText`
   */
  _sectionContent(noteContent, sectionHeadingText) {
    const regex = new RegExp(`#\\s*${ sectionHeadingText }\\n([\\s\\S]+?)\\n#`, "m");
    // For reasons undetermined, \Z not working as a secondary terminator of string, so we add a # to the end
    const match = (noteContent + "\n#").match(regex);
    return match ? match[1] : null;
  },

  /*******************************************************************************************
   * `book` can be either a highlights LIST from a book, or a book returned by BOOKS list
   */
  _bookNotePrefaceContentFromReadwiseBook(app, book, note) {
    return `![Book cover](${ book.cover_image_url })\n` +
      `- **[${ book.title }](https://www.amplenote.com/notes/${ note.uuid })**\n` +
      `- Book Author: ${ book.author }\n` +
      `- Category: ${ book.category }\n` +
      `- Source: ${ book.source_url ? `[${ book.source }](${ book.source_url })` : book.source }\n` +
      `- ${ this._localeDateFromIsoDate(app, book.last_highlight_at) }\n` +
      `- [View all highlights on Readwise](https://readwise.io/bookreview/${ book.id })\n` +
      `\n\n`; // Since replace will get rid of all content up to the next heading
  },

  /*******************************************************************************************
   * Given a note handle, returns the "last updated at" time, if any.
   * Returns null if none was found.
   */
  async _getLastUpdatedTimeFromNote(app, noteHandle) {
    console.log(`_getLastUpdatedTimeFromNote(${ app }, ${ noteHandle }`);
    const content = await app.getNoteContent({ uuid: noteHandle.uuid });
    if (!content) {
      console.log("Empty note.");
      return null;
    }

    const lines = content.split("\n");
    if (lines.length === 0) {
      console.log("Also empty note.");
      return null;
    }

    const dateLine = lines.find(line => line.includes(this.constants.updateStringPreface))
    let result = null;
    if (dateLine) {
      const dateString = dateLine.replace(this.constants.updateStringPreface, "");
      const result = new Date(dateString);
      if (isNaN(result.getTime())) {
        console.log("Could not ascertain date from", dateString);
        return null;
      }
    }

    console.log(`Last updated detected: ${ result?.getTime() }`);
    return result;
  },

  /*******************************************************************************************
   * Returns the `book` json object from Readwise. Currently contains keys for [id, title, author, category, source,
   * cover_image_url], and other stuff enumerated at https://readwise.io/api_deets under "Books LIST"
   */
  async* _readwiseFetchBooks(app) {
    console.log(`_readwiseFetchBooks(app)`);
    const url = new URL(`${ this.constants.readwiseBookIndexURL }/`);
    yield* this._readwisePaginateRequest(app, url);
  },

  /*******************************************************************************************
   * Returns a generator of highlights, given a book ID
   */
  async* _readwiseGetAllHighlightsForBook(app, bookId, updatedGt) {
    console.log(`_readwiseGetAllHighlightsForBook(app, ${ bookId }, ${ updatedGt }`);
    const url = new URL(`${ this.constants.readwiseHighlightsIndexURL }/`);
    const params = new URLSearchParams();
    params.append('book_id', bookId);

    if (updatedGt) {
      params.append('updated__gt', updatedGt.toISOString().slice(0, -1) + 'Z');
    }

    url.search = params;

    yield* this._readwisePaginateRequest(app, url);
  },

  /*******************************************************************************************
   * Returns a generator of results as found in data.results.
   * Paginates results given a baseURL, by adding &page= at the end of the path.
   */
  async* _readwisePaginateRequest(app, baseUrl) {
    let currentPage = 1;
    let hasNextPage = true;

    while (hasNextPage) {
      baseUrl.searchParams.append('page', currentPage);
      const data = await this._readwiseMakeRequest(app, baseUrl);
      for (const item of data.results) {
        yield item;
      }
      hasNextPage = data.next !== null;
      currentPage++;
    }
  },

  /*******************************************************************************************
   * Makes a request to Readwise, adds authorization Headers from app.settings.
   * Returns the response.json() object of the request.
   */
  async _readwiseMakeRequest(app, url) {
    const readwiseAPIKey = app.settings["Readwise Access Token"];
    if (!readwiseAPIKey || readwiseAPIKey.trim() === '') {
      throw new Error('Readwise API key is empty. Please provide a valid API key.');
    }

    const headers = new Headers({ "Authorization": `Token ${ readwiseAPIKey }`, "Content-Type": 'application/json' });

    // Wait to ensure we don't exceed the requests/minute quota of Readwise
    await this._ensureRequestDelta(app);

    // Use a proxy until Readwise adds CORS preflight headers
    const proxyUrl = `https://amplenote-readwise-cors-anywhere.onrender.com/${ url.toString() }`;
    const response = await fetch(proxyUrl, { method: 'GET', headers });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${ response.status }`);
    }

    return response.json();
  },

  /*******************************************************************************************
   * Blocks until the next request can be made, as specified by this.constants.rateLimit.
   */
  async _ensureRequestDelta(app) {
    const currentTime = new Date(); // Get the current time

    if (this._lastRequestTime) { // Check if there was a previous request
      const timeDifference = (currentTime - this._lastRequestTime) / 60000; // Calculate the time difference in minutes

      if (timeDifference >= 1) {
        this._requestsCount = 0; // Reset the request count if more than 1 minute has passed
      }

      // Check if the request count is greater than or equal to the rate limit
      if (this._requestsCount >= this.constants.rateLimit) {
        const waitTime = 60000 - timeDifference * 60000; // Calculate the remaining time in milliseconds before the next minute is reached
        app.alert(`Waiting for ${ waitTime / 1000 } seconds... Hang tight.`); // Alert the user about the waiting time
        await new Promise((resolve) => setTimeout(resolve, waitTime)); // Wait for the remaining time before making the next request
        this._requestsCount = 0; // Reset the request count after waiting
      }
    }
    this._lastRequestTime = currentTime; // Update the last request time to the current time
    this._requestsCount++; // Increment the request count
  },

  /*******************************************************************************************
   * Transform text block to lower-cased dasherized text
   */
  _textToTagName(text) {
    if (!text) return null;
    return text.toLowerCase().trim().replace(/[^a-z0-9\/]/g, "-");
  },

  /*******************************************************************************************/
  _localeDateFromIsoDate(app, dateStringOrObject) {
    try {
      const dateObject = new Date(dateStringOrObject);
      const dateFormat = app.settings[this.constants.settingDateFormat] || "en-US";
      let result = dateObject.toLocaleDateString(dateFormat, { month: "long", day: "numeric", year: "numeric" });
      const recentDateCutoff = (new Date()).setDate((new Date()).getDate() - 3);
      if (dateObject > recentDateCutoff) {
        result += " at " + dateObject.toLocaleTimeString(dateFormat, { hour: "numeric", minute: "2-digit", hour12: true });
      }
      return result;
    } catch (e) {
      console.error("There was an error parsing your date string", dateStringOrObject, e)
      return dateStringOrObject;
    }
  }
}
