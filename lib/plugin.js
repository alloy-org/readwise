const plugin = {
  constants: {
    defaultBaseTag: "library",
    dashboardBookListTitle: "Readwise Book List",
    defaultDashboardNoteTitle: "Readwise Library Dashboard",
    defaultHighlightSort: "newest",
    dashboardLibraryDetailsHeading: "Library Details",
    maxBooksFetchedPerInvoke: 1000,
    maxReplaceContentLength: 100000, // Empirically derived
    maxHighlightLimit: 5000,
    rateLimit: 20, // Max requests per minute (20 is Readwise limit for Books and Highlights APIs)
    readwiseBookDetailURL: bookId => `https://readwise.io/api/v2/books/${ bookId }`,
    readwiseBookIndexURL: "https://readwise.io/api/v2/books",
    readwiseHighlightsIndexURL: "https://readwise.io/api/v2/highlights",
    readwisePageSize: 1000, // Highlights and Books both claim they can support page sizes up to 1000 so we'll take them up on that to reduce number of requests we need to make
    settingDateFormat: "Date format (default: en-US)",
    settingDiscardedName: "Import discarded highlights (\"true\" or \"false\". Default: false)",
    settingSortOrderName: "Highlight sort order (\"newest\" or \"oldest\". Default: newest)",
    settingTagName: "Base tag for Readwise notes (Default: library)",
    updateStringPreface: "- Highlights updated at: ",
  },

  _abortExecution: false,
  _dateFormat: null,
  _forceReprocess: false,
  _lastRequestTime: null,
  _requestsCount: 0,

  noteOption: {
    /*******************************************************************************************
     * Fetches all books found in Readwise. Creates a note per book.
     */
    "Sync all": async function (app, noteUUID) {
      try {
        const dashboardNoteTitle = app.settings[`Readwise dashboard note title (default: ${ this.constants.defaultDashboardNoteTitle })`] ||
          this.constants.defaultDashboardNoteTitle;

        [ this._forceReprocess, this._dateFormat ] = await app.prompt("Readwise sync options", {
          inputs: [
            { label: "Force reprocess of all book highlights?", type: "select", options:
              [
                { value: "false", label: `No (uses "Last updated" dates to sync only new)` },
                { value: "true", label: `Yes (slower, uses more quota)` }
              ]
            },
            { label: "Date format", type: "select", options:
              [
                { value: "default", label: `Current default (${ app.settings[this.constants.settingDateFormat] || "en-US" })` },
                { value: "en-US", label: "en-US (English - United States)" },
                { value: "en-GB", label: "en-GB (English - United Kingdom)" },
                { value: "de-DE", label: "de-DE (German - Germany)" },
                { value: "fr-FR", label: "fr-FR (French - France)" },
                { value: "es-ES", label: "es-ES (Espanol - Spain)" },
                { value: "it-IT", label: "it-IT (Italian - Italy)" },
                { value: "ja-JP", label: "ja-JP (Japanese - Japan)" },
                { value: "ko-KR", label: "ko-KR (Korean - Korea)" },
                { value: "pt-PT", label: "pt-PT (Portuguese - Portugal)" },
                { value: "pt-BR", label: "pt-BR (Portuguese - Basil)" },
                { value: "zh-CN", label: "zh-CN (Chinese - China)" },
                { value: "zh-TW", label: "zh-TW (Chinese - Taiwan)" },
              ]
            },
          ]
        })

        // Ensure that dashboardNote exists in a state where await dashboardNote.content() can be called on it
        let dashboardNote = await app.findNote({ name: dashboardNoteTitle, tag: this.constants.defaultBaseTag });
        if (dashboardNote) {
          console.log("Found existing dashboard note", dashboardNote, "for", dashboardNoteTitle);
          dashboardNote = await app.notes.find(dashboardNote.uuid);
        } else {
          console.log("Creating dashboard note anew");
          dashboardNote = await app.notes.create(dashboardNoteTitle, [ this.constants.defaultBaseTag ]);
        }

        // Move to existing or new dashboard note
        if (noteUUID !== dashboardNote.uuid) {
          const origin = window.location.origin.includes("localhost") ? "http://localhost:3000" : window.location.origin.replace("plugins", "www");
          const navigateUrl = `${ origin }/notes/${ dashboardNote.uuid }`
          await app.navigate(navigateUrl);
        }

        await this._prependReadwiseBookCountContent(app, dashboardNote);
        let bookCount = 0;

        // Fetch a book, create its note and add its highlights
        for await (const readwiseBook of this._readwiseFetchBooks(app)) {
          if (bookCount > this.constants.maxBooksFetchedPerInvoke) break;
          if (this._abortExecution) break;

          const bookNote = await this._ensureBookNote(app, readwiseBook, dashboardNote);
          await this._ensureBookInDashboardNoteTable(app, dashboardNote, readwiseBook, bookNote.uuid);
          await this._syncBookHighlights(app, bookNote, readwiseBook.id, readwiseBook);
          bookCount += 1;
        }

        if (this._abortExecution) {
          await app.alert(`✅ ${ bookCount } book${ bookCount === "1" ? "" : "s" } fetched & refreshed successfully!`);
        } else {
          await app.alert(`⚠️ ${ bookCount } book${ bookCount === "1" ? "" : "s" } refreshed before encountering error. Please try again later.`);
        }

      } catch (error) {
        await app.alert(String(error));
        this._abortExecution = true;
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
    let lastUpdatedAt = await this._getLastUpdatedTimeFromNote(app, bookNote);
    if (this._forceReprocess) {
      lastUpdatedAt = null;
    }

    // Import all (new) highlights from the book
    const noteContent = await bookNote.content();

    if (!noteContent.includes("# Summary")) {
      bookNote.insertContent("# Summary\n");
    }

    if (!readwiseBook) {
      readwiseBook = await this._readwiseMakeRequest(app, this.constants.readwiseBookDetailURL(readwiseBookID));
    }

    const summaryContent = this._bookNotePrefaceContentFromReadwiseBook(app, readwiseBook, bookNote.uuid);
    bookNote.replaceContent(summaryContent, this._sectionFromHeadingText("Summary"));

    let highlightsContent = "";
    if (!noteContent.includes("# Highlights")) {
      bookNote.insertContent("\n# Highlights\n", { atEnd: true });
    } else {
      highlightsContent = this._sectionContent(noteContent, "Highlights");
    }

    let replaceContent = await this._bookHighlightsContentFromReadwiseBook(app, readwiseBook, highlightsContent, lastUpdatedAt);
    try {
      if (replaceContent.length > this.constants.maxReplaceContentLength) {
        // Not sure yet how best to deal with notes that have more than 100,000 characters of Highlight content.
        console.error("Truncating highlight content by", this.constants.maxReplaceContentLength - replaceContent.length, "characters");
        replaceContent = replaceContent.slice(0, this.constants.maxReplaceContentLength - 4) + " ...";
      }
      await bookNote.replaceContent(replaceContent, this._sectionFromHeadingText("Highlights"));
    } catch (error) {
      console.log("Error replacing", readwiseBook.title, "content, length", replaceContent.length ," error", error);
    }

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
  async _ensureBookNote(app, readwiseBook) {
    const baseTag = app.settings[this.constants.settingTagName] || this.constants.defaultBaseTag;
    console.log(`_ensureBookNote(${ readwiseBook.title }`, baseTag);

    // First, check if the note for this book exists
    const readwiseNotes = await app.filterNotes({ tag: baseTag });
    const bookRegex = new RegExp(`ID\\s?#${ readwiseBook.id }`);
    const searchResults = readwiseNotes.filter(item => bookRegex.test(item.name));
    let bookNote = null;
    if (searchResults.length === 0) {
      const noteTitle = this._noteTitleFromBook(readwiseBook);

      // Create the note if it doesn't exist
      bookNote = await app.notes.create(noteTitle, [`${ baseTag }/${ this._textToTagName(readwiseBook.category) }`,
        `${ baseTag }/${ this._textToTagName(readwiseBook.author) }`]);
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
   * Transform text block to lower-cased dasherized text
   */
  _textToTagName(text) {
    if (!text) return null;
    return text.toLowerCase().trim().replace(/[^a-z0-9\/]/g, "-");
  },

  /*******************************************************************************************/
  _localeDateFromIsoDate(app, dateStringOrObject) {
    try {
      if (!dateStringOrObject) return "";
      const dateObject = new Date(dateStringOrObject);
      const dateFormat = this._dateFormat || app.settings[this.constants.settingDateFormat] || "en-US";
      let result = dateObject.toLocaleDateString(dateFormat, { month: "long", day: "numeric", year: "numeric" });
      const recentDateCutoff = (new Date()).setDate((new Date()).getDate() - 3);
      if (dateObject > recentDateCutoff) {
        result += " " + dateObject.toLocaleTimeString(dateFormat, { hour: "numeric", minute: "2-digit", hour12: true });
      }
      return result;
    } catch (e) {
      console.error("There was an error parsing your date string", dateStringOrObject, e)
      return dateStringOrObject;
    }
  },

  /*******************************************************************************************
   * `book` can be either a highlights LIST from a book, or a book returned by BOOKS list
   */
  _bookNotePrefaceContentFromReadwiseBook(app, book, bookNoteUUID) {
    let sourceContent = book.source_url ? `[${ book.source }](${ book.source_url })` : book.source;
    let asinContent = "";
    if (book.asin) {
      if (book.source.toLowerCase().includes("kindle")) {
        const kindleUrl = `kindle://book?action=open&asin=${ book.asin }`;
        sourceContent = `[${ book.source }](${ kindleUrl })`;
        asinContent = `ASIN: [${ book.asin }](${ kindleUrl })`;
      } else {
        asinContent = `ASIN: [${ book.asin }](https://www.amazon.com/dp/${ book.asin })`;
      }
    }

    const baseTag = app.settings[this.constants.settingTagName] || this.constants.defaultBaseTag;
    return `![Book cover](${ book.cover_image_url })\n` +
      `- **${ book.title }**\n` +
      `- Book Author: [${ book.author }](/notes/${ bookNoteUUID }?tag=${ baseTag }/${ this._textToTagName(book.author) })\n` +
      `- Category: ${ book.category }\n` +
      `- Source: ${ sourceContent }\n` +
      (asinContent ? `- ${ asinContent }\n` : "") +
      `- Highlight count: ${ book.num_highlights }\n` +
      `- Last highlight: ${ this._localeDateFromIsoDate(app, book.last_highlight_at) }\n` +
      `- [View all highlights on Readwise](https://readwise.io/bookreview/${ book.id })\n` +
      `\n\n`; // Since replace will get rid of all content up to the next heading
  },

  /*******************************************************************************************
   * Ensure that a book row exists in dashboard note. Will be inserted in top table row if not.
   */
  async _ensureBookInDashboardNoteTable(app, dashboardNote, readwiseBook, bookNoteUUID) {
    let dashboardNoteContents = await dashboardNote.content();
    console.log("_ensureBookInDashboardNoteTable(", dashboardNote, readwiseBook, bookNoteUUID, "). dashboardNoteContents?.length:", dashboardNoteContents?.length);
    let existingTable = "";
    if (!dashboardNoteContents.includes(this.constants.dashboardBookListTitle)) {
      // Add a header to the dashboard note if it doesn't exist
      dashboardNote.insertContent(`# ${ this.constants.dashboardBookListTitle }\n`, { atEnd: true });
    } else {
      // In order to replace the table, we need to remove the preamble(s) to the existing table(s)
      existingTable = this._sectionContent(dashboardNoteContents, this.constants.dashboardBookListTitle) || "";
      [/\|\s?\*\*Cover\*\*\s?\|\s?\*\*Book Title\*\*\s?\|\s?\*\*Author\*\*\s?\|\s?\*\*Category\*\*\s?\|\s?\*\*Source\*\*\s?\|\s?\*\*Highlights\*\*\s?\|\s?\*\*Last Highlight\*\*\s?\|\s?\*\*Other Details\*\*\s?\|\n/gm,
        /\|-\|-\|-\|-\|-\|-\|-\|-\|\n/gm,
        /\| \| \| \| \| \| \| \| \|\n/gm].forEach(removeString => {
        existingTable = existingTable.replace(removeString, "").trim();
      });
    }

    const tablePreambleContent = `| **Cover** | **Book Title** | **Author** | **Category** | **Source** | **Highlights** | **Last Highlight** | **Other Details** |\n` +
      `|-|-|-|-|-|-|-|-|\n`;
    let sourceContent = readwiseBook.source;
    if (sourceContent === "kindle" && readwiseBook.asin) {
      sourceContent = `[${ readwiseBook.source }](kindle://book?action=open&asin=${ readwiseBook.asin })`;
    } else if (readwiseBook.source_url) {
      sourceContent = `[${ readwiseBook.source }](${ readwiseBook.source_url })`;
    }

    const bookRowContent = `| ![${ readwiseBook.title } cover](${ readwiseBook.cover_image_url }) ` +
      `| [${ readwiseBook.title }](https://www.amplenote.com/notes/${ bookNoteUUID }) ` +
      `| ${ readwiseBook.author } ` +
      `| ${ readwiseBook.category } ` +
      `| ${ sourceContent } ` +
      `| [${ readwiseBook.num_highlights } highlight${ readwiseBook.num_highlights === 1 ? "" : "s" }](https://www.amplenote.com/notes/${ bookNoteUUID }#Highlights}) ` +
      `| ${ this._localeDateFromIsoDate(app, readwiseBook.last_highlight_at) } ` +
      `| [Readwise link](https://readwise.io/bookreview/${ readwiseBook.id }) |\n`;
    let readwiseTableContent
    // Already inserted this book into our dashboard ToC, remove it so it can be refreshed
    const existingRowRegex = new RegExp(`^\\|[^|]+\\|.*${ readwiseBook.id }.*\\|\n`, "m")
    if (dashboardNoteContents.match(existingRowRegex)) {
      readwiseTableContent = tablePreambleContent + existingTable.replace(existingRowRegex, bookRowContent) + "\n";
    } else {
      readwiseTableContent = tablePreambleContent + bookRowContent + existingTable + "\n";
    }

    const replaceSection = this._sectionFromHeadingText(this.constants.dashboardBookListTitle);
    await dashboardNote.replaceContent(readwiseTableContent, replaceSection);
    await this._updateDashboardDetails(app, dashboardNote, await dashboardNote.content());
  },

  /*******************************************************************************************
   * Generate the string that should be inserted into the "Highlights" section of a note.
   * Will always return a non-null string
   */
  async _bookHighlightsContentFromReadwiseBook(app, readwiseBook, existingHighlightsContent, lastUpdatedAt) {
    let highlightCount = 0;
    const newHighlightsList = [];
    const sortOrder = app.settings[this.constants.settingSortOrderName] || this.constants.defaultHighlightSort;

    // Example of Highlight object: https://images.amplenote.com/d1f0c1ce-e3d4-11ed-9bea-fe0bc8306505/cfb6feb7-f3fd-4ab1-bcfa-2f7457c5923e.jpg
    console.log(`Getting all highlights for ${ readwiseBook.title }. Last updated at: ${ lastUpdatedAt }. Existing highlights length: ${ existingHighlightsContent?.length }`);
    for await (const highlight of this._readwiseGetAllHighlightsForBook(app, readwiseBook.id, lastUpdatedAt)) {
      if (highlightCount > this.constants.maxHighlightLimit) break;
      if (existingHighlightsContent.includes(`(#H${ highlight.id })`)) continue;
      if (highlight.is_discard && app.settings[this.constants.settingDiscardedName] !== "true") continue;
      if (this._abortExecution) break;

      let highlightContent = `> ### ${ highlight.text }\n\n`;
      if (highlight.location) {
        highlightContent += `**Location**: [View ${ highlight.location } on Kindle](kindle://book?action=open&asin=${ readwiseBook.asin }&location=${ highlight.location }) ` +
          `or on [Readwise](https://readwise.io/bookreview/${ highlight.id })\n`;
      }
      if (highlight.note) highlightContent += `**Note**: ${ highlight.note }\n`;
      if (highlight.color) highlightContent += `**Highlight color**: ${ highlight.color }\n`;
      highlightContent += `**Highlighted at**: ${ this._localeDateFromIsoDate(app, highlight.highlighted_at) } (#H${ highlight.id })\n`;

      // Empirically confirmed that RW returns results by newest, so we want every older result appended
      if (sortOrder === "newest") {
        newHighlightsList.push(highlightContent);
      } else {
        newHighlightsList.unshift(highlightContent);
      }
      highlightCount++;
    }

    let replaceContent = "";
    if (newHighlightsList.length) {
      // Highlight IDs were added June 2023, after initial launch. If the plugin content doesn't show existing signs of
      // highlight IDs, we'll replace all highlight content to avoid dupes
      if (/\(#H[\d]+\)/.test(existingHighlightsContent)) {
        replaceContent = newHighlightsList.join("\n") + "\n" + existingHighlightsContent + "\n\n";
      } else {
        replaceContent = newHighlightsList.join("\n") + "\n\n";
      }
    } else {
      replaceContent = existingHighlightsContent;
    }
    return replaceContent;
  },

  /*******************************************************************************************
   * Given a note handle, returns the "last updated at" time, if any.
   * Returns null if none was found.
   */
  async _getLastUpdatedTimeFromNote(app, noteHandle) {
    const content = await app.getNoteContent({ uuid: noteHandle.uuid });
    if (!content) return null;

    const lines = content.split("\n");
    if (lines.length === 0) {
      console.log("Found empty note parsing for date.");
      return null;
    }

    // Translate our human friendly "June 6, 2023 at 5:01pm" into an object that Date.parse understands, e.g., June 6, 2023 17:01
    const dateLine = lines.find(line => line.includes(this.constants.updateStringPreface))
    let result = null;
    if (dateLine) {
      let dateString = dateLine.replace(this.constants.updateStringPreface, "");
      console.log("Parsing", dateString);
      if (dateString.includes("pm")) {
        const hourMatch = dateString.match(/at\s([\d]{1,2}):/);
        if (hourMatch) {
          dateString = dateString.replace(` ${ hourMatch[1] }:`, ` ${ parseInt(hourMatch[1]) + 12 }:`);
        } else {
          console.error("Error parsing dateString");
        }
      }
      dateString = dateString.toLowerCase().replace(/\s?[ap]m/, "").replace(" at ", " ");
      const parsedDate = Date.parse(dateString);

      result = new Date(parsedDate);
      if (isNaN(result.getTime())) {
        console.log("Could not ascertain date from", dateString);
        return null;
      }
    } else {
      console.log("Couldn't find a line containing the update time for note", noteHandle.uuid);
    }

    if (result) console.log(`Last updated detected: ${ result.getTime() }`);
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
  async* _readwiseGetAllHighlightsForBook(app, bookId, updatedAfter) {
    console.log(`_readwiseGetAllHighlightsForBook(app, ${ bookId }, ${ updatedAfter }`);
    const url = new URL(`${ this.constants.readwiseHighlightsIndexURL }/`);
    const params = new URLSearchParams();
    params.append('book_id', bookId);

    if (updatedAfter) {
      params.append('updated__gt', updatedAfter.toISOString().slice(0, -1) + 'Z');
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
      baseUrl.searchParams.append('page_size', this.constants.readwisePageSize);
      const data = await this._readwiseMakeRequest(app, baseUrl);
      for (const item of data.results) {
        if (this._abortExecution) break;
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
        // Alert the user about the waiting time
        app.alert(`Waiting for ${ Math.floor(waitTime / 1000) } seconds to satisfy Readwise API limit... You can wait here, or click "OK" to dismiss, and we will update notes as you work. ⏳  \n\nWorking concurrently while notes are being changed may lead to merge issues, so we recommend minimizing note changes while a sync is in progress.`);
        await new Promise((resolve) => setTimeout(resolve, waitTime)); // Wait for the remaining time before making the next request
        this._requestsCount = 0; // Reset the request count after waiting
      }
    }
    this._lastRequestTime = currentTime; // Update the last request time to the current time
    this._requestsCount++; // Increment the request count
  },

  /*******************************************************************************************
   * Print the count of books reported by Readwise atop the Dashboard note
   */
  async _prependReadwiseBookCountContent(app, dashboardNote) {
    const bookIndexResponse = await this._readwiseMakeRequest(app, `${ this.constants.readwiseBookIndexURL }?page_size=1`)
    if (bookIndexResponse?.count) {
      const dashboardNoteContent = await dashboardNote.content();
      if (!dashboardNoteContent.includes(this.constants.dashboardLibraryDetailsHeading)) {
        await dashboardNote.insertContent("# " + this.constants.dashboardLibraryDetailsHeading + "\n");
      }
      let bookIndexContent = `- Book count reported by Readwise: ${ bookIndexResponse.count }\n`;
      await dashboardNote.replaceContent(bookIndexContent, this._sectionFromHeadingText(this.constants.dashboardLibraryDetailsHeading));
      await this._updateDashboardDetails(app, dashboardNote, dashboardNoteContent, { bookCount: bookIndexResponse.count });
    } else {
      console.log("Did not received a Book index response from Readwise. Not updating Dashboard content")
    }
  },

  /*******************************************************************************************
   * Keep details about imported books updated
   */
  async _updateDashboardDetails(app, dashboardNote, dashboardNoteContent, { bookCount = null } = {}) {
    dashboardNoteContent = (dashboardNoteContent || "");
    const existingDetailContent = this._sectionContent(dashboardNoteContent, this.constants.dashboardLibraryDetailsHeading) || "";
    let detailContent = `- Updated at: ${ this._localeDateFromIsoDate(app, new Date()) }\n`;
    const tableRowCount = dashboardNoteContent.match(/^\|!\[]/gm)?.length || 0;
    detailContent += `- Readwise books imported into table: ${ tableRowCount }\n`;
    const readwiseCountMatch = existingDetailContent.match(/Book count reported by Readwise: ([\d]+)/m);
    const readwiseCount = bookCount ? bookCount : (readwiseCountMatch ? parseInt(readwiseCountMatch[1]) : null);
    if (Number.isInteger(readwiseCount)) detailContent += `- Book count reported by Readwise: ${ readwiseCount }\n`;

    await dashboardNote.replaceContent(detailContent, this._sectionFromHeadingText(this.constants.dashboardLibraryDetailsHeading));
  },
}
