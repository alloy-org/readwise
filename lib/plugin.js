const plugin = {
  // TODO: handle abort execution
  // TODO: add conditions to plugin actions
  constants: {
    defaultBaseTag: "library",
    dashboardBookListTitle: "Readwise Book List",
    defaultDashboardNoteTitle: "Readwise Library Dashboard",
    defaultHighlightSort: "newest",
    dashboardLibraryDetailsHeading: "Library Details",
    dashDetails: {
      lastSyncedAt: "Last synced at",
      firstUpdated: "Oldest update synced in",
      lastUpdated: "Next sync for content updated after",
      booksImported: "Readwise books imported into table",
      booksReported: "Book count reported by Readwise",
    },
    maxBookLimitInMemory: 20,
    maxReplaceContentLength: 100000, // Empirically derived
    maxHighlightLimit: 5000,
    maxTableBooksPerSection: 20,
    maxBookHighlightsPerSection: 10,
    maxBookLimit: 500,
    noHighlightSectionLabel: "(No highlights yet)",
    rateLimit: 20, // Max requests per minute (20 is Readwise limit for Books and Highlights APIs)
    readwiseBookDetailURL: bookId => `https://readwise.io/api/v2/books/${ bookId }`,
    readwiseBookIndexURL: "https://readwise.io/api/v2/books",
    readwiseExportURL: "https://readwise.io/api/v2/export",
    readwiseHighlightsIndexURL: "https://readwise.io/api/v2/highlights",
    readwisePageSize: 1000, // Highlights and Books both claim they can support page sizes up to 1000 so we'll take them up on that to reduce number of requests we need to make
    sectionRegex: /^#+\s*([^#\n\r]+)/gm,
    settingAuthorTag: "Save authors as tags (\"true\" or \"false\". Default: false)",
    settingDateFormat: "Date format (default: en-US)",
    settingDiscardedName: "Import discarded highlights (\"true\" or \"false\". Default: false)",
    settingSortOrderName: "Highlight sort order (\"newest\" or \"oldest\". Default: newest)",
    settingTagName: "Base tag for Readwise notes (Default: library)",
    sleepSecondsAfterRequestFail: 10,
    updateStringPreface: "- Highlights updated at: ",
    unsortedSectionTitle: "Books pending sort",
  },

  appOption: {
    /*******************************************************************************************
     * Fetches all books found in Readwise. Creates a note per book.
     */
    "Sync all": async function (app) {
      this._initialize(app);
      this._useLocalNoteContents = true;
      await this._syncAll(app);
    },
  },

  noteOption: {
    /*******************************************************************************************
     * Fetches all books found in Readwise. Creates a note per book.
     */
    "Sync all": async function (app, noteUUID) {
      this._initialize(app);
      this._useLocalNoteContents = true;
      await this._syncAll(app, noteUUID);
    },

    /*******************************************************************************************
     * Syncs newer highlights for an individual book.
     * Fails if the note title doesn't match the required template.
     */
    "Sync this book": async function(app, noteUUID) {
      this._initialize(app);
      this._useLocalNoteContents = true;
      await this._syncThisBook(app, noteUUID);
    },

    /*******************************************************************************************
     * Fetches all items of a certain category. Creates a note per item.
     */
    "Sync only...": async function(app, noteUUID) {
      this._initialize(app);
      this._useLocalNoteContents = true;
      await this._syncOnly(app, noteUUID);
    },
  },



  /*******************************************************************************************/
  /* Main entry points
  /*******************************************************************************************/
  async _syncAll(app, noteUUID, categoryFilter) {
    console.log("Starting sync all", new Date());
    try {
      const dashboardNoteTitle = app.settings[`Readwise dashboard note title (default: ${ this.constants.defaultDashboardNoteTitle })`] ||
        this.constants.defaultDashboardNoteTitle;

      if (this._abortExecution) app.alert("_abortExecution is true")
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
      });

      // Ensure that dashboardNote exists in a state where await this._noteContent(dashboardNote) can be called on it
      const baseTag = app.settings[this.constants.settingTagName] || this.constants.defaultBaseTag;
      let dashboardNote = await app.findNote({ name: dashboardNoteTitle, tag: baseTag});
      if (dashboardNote) {
        console.log("Found existing dashboard note", dashboardNote, "for", dashboardNoteTitle);
        dashboardNote = await app.notes.find(dashboardNote.uuid);
      } else {
        console.log("Creating dashboard note anew");
        dashboardNote = await app.notes.create(dashboardNoteTitle, [ baseTag ]);
      }
      

      // Move to existing or new dashboard note
      if (app.context.noteUUID !== dashboardNote.uuid) {
        let origin;
        try {
          origin = window.location.origin.includes("localhost") ? "http://localhost:3000" : window.location.origin.replace("plugins", "www");
        } catch (err) {
          if (err.name === "TypeError") throw(new Error("null.replace error on line 137"));
        }

        const navigateUrl = `${ origin }/notes/${ dashboardNote.uuid }`;
        await app.navigate(navigateUrl);
      }

      let bookCount = 0;

      await this._migrateBooksToSections(app, dashboardNote);



      let dashboardNoteContents = await this._noteContent(dashboardNote);
      const details = this._loadDetails(this._sectionContent(dashboardNoteContents, this.constants.dashboardLibraryDetailsHeading));
      if (!dashboardNoteContents.includes(this.constants.dashboardLibraryDetailsHeading)) {
        await this._insertContent(dashboardNote, "# " + this.constants.dashboardLibraryDetailsHeading + "\n");
      }
      if (!dashboardNoteContents.includes(this.constants.dashboardBookListTitle)) {
        // Add a header to the dashboard note if it doesn't exist
        // Edits dashboard note
        await this._insertContent(dashboardNote, `# ${ this.constants.dashboardBookListTitle }\n`, { atEnd: true });
      }

      const updateThrough = details.lastUpdated;
      let dateFilter = null;
      if (updateThrough) {
        dateFilter = new Date(Date.parse(updateThrough));
        dateFilter = dateFilter.toISOString().slice(0, -1) + 'Z';
        console.log("Looking for results after", updateThrough, "submitting as", dateFilter);
      }
      let dashboard = await this._sectionsFromMarkdown(dashboardNote, this.constants.dashboardBookListTitle, this._tableFromMarkdown);
      dashboard = this._groupByValue(dashboard,
        item => {
          let updated = item.Updated;
          if (updated === "No highlights" || !updated) return "No highlights";
          return this._dateObjectFromDateString(item.Updated).getFullYear();
        },
      );
      let readwiseBookCount = await this._getReadwiseBookCount(app);
      if (readwiseBookCount) {
        await this._updateDashboardDetails(app, dashboard, details, { bookCount: readwiseBookCount });
      }

      for await (const readwiseBook of this._readwiseFetchBooks(app, {dateFilter, categoryFilter})) {
        if (this._abortExecution) break;
        if (!readwiseBook) continue;
        if (bookCount >= this.constants.maxBookLimit) break;

        const bookNote = await this._ensureBookNote(app, readwiseBook, dashboardNote);
        const bookObject = this._bookObjectFromReadwiseBook(app, readwiseBook, bookNote.uuid);
        
        // Edits dashboard object
        await this._ensureBookInDashboardNoteTable(app, dashboard, bookObject);

        // Edits book note
        const success = await this._syncBookHighlights(app, bookNote, readwiseBook.id, { readwiseBook });
        if (success) bookCount += 1;
      }
      // Edits dashboard note
      // Let's load it again just in case it was deleted in previous flush notes
      // TODO: fixme
      await this._noteContent(dashboardNote);
      let tableRowCount = Object.values(dashboard).reduce((total, curr) => total + curr.length, 0);
      await this._updateDashboardDetails(app, dashboard, details, {tableRowCount});
      let markdownDetails = this._writeDetails(details);
      await this._replaceContent(dashboardNote, this.constants.dashboardLibraryDetailsHeading, markdownDetails);

      await this._writeDashboard(app, dashboard, dashboardNote);

      if (this._useLocalNoteContents) {
        await this._flushLocalNotes(app);
      }
      if (this._abortExecution) {
        await app.alert(`✅️ ${ bookCount } book${ bookCount === "1" ? "" : "s" } refreshed before canceling sync.`);
      } else {
        await app.alert(`✅ ${ bookCount } book${ bookCount === "1" ? "" : "s" } fetched & refreshed successfully!`);
      }
    } catch (error) {
      if (this._testEnvironment) {
        throw(error);
      } else {
        console.trace();
        await app.alert(String(error));
        this._abortExecution = true;
      }
    } finally {
      this._useLocalNoteContents = false;
    }
  },

  /*******************************************************************************************/
  async _syncThisBook(app, noteUUID) {
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
      const success = await this._syncBookHighlights(app, currentNote, bookId, { throwOnFail: true });
      if (this._useLocalNoteContents) {
        await this._flushLocalNotes(app);
      }
      if (success) {
        await app.alert("✅ Book highlights fetched successfully!");
      }
    } catch (error) {
      await app.alert(String(error));
    }
  },

  /*******************************************************************************************/
  async _syncOnly(app, noteUUID) {
    try {
      // As per docs: category is one of books, articles, tweets, supplementals or podcasts
      const categories = ["books", "articles", "tweets", "supplementals", "podcasts"];
      let result = await app.prompt(
        "What category of highlights would you like to sync?", {
          inputs: [{
            type: "select",
            label: "Category",
            options: categories.map(function(value, index) {
              return { value: value, label: value };
            })
          }]
        }
      );
      if (result) await this._syncAll(app, noteUUID, result);
    } catch (err) {
      app.alert(err);
    }
  },



  /*******************************************************************************************/
  /* Dashboard manipulation
  /*******************************************************************************************/

  /*******************************************************************************************
   * Persists a dashboard ojbect into the dashboardNote note
   */
  async _writeDashboard(app, dashboard, dashboardNote) {
    console.debug(`_writeDashboard()`);
    // SORT each section
    for (let [key, value] of Object.entries(dashboard)) {
      dashboard[key] = value.sort(this._sortBooks);
    }
    // SORT the order of sections
    dashboard = this._distributeIntoSmallGroups(app, dashboard, this.constants.maxTableBooksPerSection);
    let entries = Object.entries(dashboard);
    entries.sort((a, b) => b[0].localeCompare(a[0]));

    let dashboardMarkdown = this._markdownFromSections(entries, this._markdownFromTable());
    await this._replaceContent(dashboardNote, this.constants.dashboardBookListTitle, dashboardMarkdown);
  },

  /*******************************************************************************************
   * Insert a book object in the dashboard object
   */
  async _ensureBookInDashboardNoteTable(app, dashboard, bookObject) {
    console.log(`_ensureBookInDashboardNoteTable(app, ${bookObject})`);

    for (let year of Object.keys(dashboard)) {
      let entries = dashboard[year];
      for (let e of entries) {
        console.debug(e["Book Title"]);
      }
    }
    this._removeBookFromDashboard(dashboard, bookObject);
    let year = this._sectionNameFromLastHighlight(bookObject.Updated);

    if (year in dashboard) {
      dashboard[year].push(bookObject);
      dashboard[year] = dashboard[year].sort(this._sortBooks);
    } else {
      dashboard[year] = [bookObject];
    }
  },

  _sectionNameFromLastHighlight(lastHighlightDateString) {
    let year = "";
    if (lastHighlightDateString && this._dateObjectFromDateString(lastHighlightDateString)) {
      year = this._dateObjectFromDateString(lastHighlightDateString).getFullYear();
    } else {
      year = this.constants.noHighlightSectionLabel;
    }
    return year;
  },

  /*******************************************************************************************
   * Removes a book represented by a book object from the dashboard object
   */
  _removeBookFromDashboard(dashboard, bookObject) {
    for (let year of Object.keys(dashboard)) {
      const index = dashboard[year].findIndex(book => bookObject["Book Title"] === book["Book Title"]);
      if (index !== -1) {
        dashboard[year].splice(index, 1);
        break;
      }
    }
  },

  /*******************************************************************************************
   * Print the count of books reported by Readwise atop the Dashboard note
   */
  async _getReadwiseBookCount(app) {
    const bookIndexResponse = await this._readwiseMakeRequest(app, `${ this.constants.readwiseBookIndexURL }?page_size=1`);
    if (bookIndexResponse?.count) {
      return bookIndexResponse.count;
    }
    else {
      console.log("Did not received a Book index response from Readwise. Not updating Dashboard content");
      return null;
    }
  },

  /*******************************************************************************************
   * Keep details about imported books updated
   */
  async _updateDashboardDetails(app, dashboard, details, {tableRowCount = null, bookCount = null } = {}) {
    console.log(`_updateDashboardDetails(app, ${dashboard}, ${details}, ${tableRowCount}, ${bookCount} )`);
    let dashDetails = this.constants.dashDetails;

    const lastUpdatedAt = this._boundaryBookUpdatedAtFromDashboard(dashboard, true);
    const earliestUpdatedAt = this._boundaryBookUpdatedAtFromDashboard(dashboard, false);

    details[dashDetails.lastSyncedAt] = this._localeDateFromIsoDate(app, new Date());
    details[dashDetails.firstUpdated] = this._localeDateFromIsoDate(app, earliestUpdatedAt);
    details[dashDetails.lastUpdated] = this._localeDateFromIsoDate(app, lastUpdatedAt);
    details[dashDetails.booksImported] = tableRowCount;
    let booksReported = details[dashDetails.booksReported];
    details[dashDetails.booksReported] = bookCount ? bookCount : booksReported;
  },

  _boundaryBookUpdatedAtFromDashboard(dashboard, findLatest) {
    let result;
    for (let group in dashboard) {
      for (let item of dashboard[group]) {
        let itemDate = this._dateObjectFromDateString(item.Updated);
        if (! itemDate || isNaN(itemDate.getTime())) {
          // No usable date object from this row
        } else if (!result || findLatest && itemDate > result || (!findLatest && itemDate < result)) {
          result = itemDate;
        }
      }
    }
    console.debug("Found lastUpdatedAt", result, "aka", this._localeDateFromIsoDate(result), "the", (findLatest ? "latest" : "earliest"), "record");
    return result;
  },

  /*******************************************************************************************
   * Load the dashboard details from Markdown into an object
   */
  _loadDetails(text) {
    let lines = text.split('\n');
    let details = {};
    
    lines.forEach(line => {
      if (!line.includes(":")) return;
        let [key, value] = line.slice(2).split(': ');
        
        // Try to convert string number to integer
        let intValue = parseInt(value, 10);
        details[key] = isNaN(intValue) ? value : intValue;
    });

    return details;
  },

  /*******************************************************************************************
   * Writes dashboard details from an object into markdown
   */
  _writeDetails(details) {
    let text = '';
    
    for (let key of Object.keys(details)) {
      text += `- ${key}: ${details[key]}\n`;
    }
    return text;
  },

  /*******************************************************************************************
   * Migrates books to sections if found otherwise
   */
  async _migrateBooksToSections(app, dashboardNote) {
    console.log(`_migrateBooksToSections`);
    const doMigrate = async () => {
      const dashboardNoteContent = await this._noteContent(dashboardNote);
      let dashboardBookListMarkdown = this._sectionContent(dashboardNoteContent, this.constants.dashboardBookListTitle);
      let bookListRows = [];
      if (dashboardBookListMarkdown) {
        bookListRows = Array.from(dashboardBookListMarkdown.matchAll(/^(\|\s*![^\n]+)\n/gm));
        if (bookListRows.length) {
          console.debug("Found", bookListRows.length, "books to potentially migrate");
        } else {
          console.debug("No existing books found to migrate");
          return;
        }
      } else {
        console.debug("No dashboard book list found to migrate");
        return;
      }

      const subSections = Array.from(dashboardBookListMarkdown.matchAll(/^##\s+([\w\s]+)/gm)).map(match =>
        match[1].trim()).filter(w => w);
      if (subSections.length && !subSections.find(heading => heading === this.constants.unsortedSectionTitle)) {
        console.log("Book list is already in sections, no migration necessary");
        return;
      } else if (!dashboardBookListMarkdown.includes(this.constants.unsortedSectionTitle)) {
        const unsortedSectionContent = `## ${ this.constants.unsortedSectionTitle }\n${ dashboardBookListMarkdown }`;
        await this._replaceContent(dashboardNote, this.constants.dashboardBookListTitle, unsortedSectionContent);
        // dashboardBookListMarkdown = this._sectionContent(await this._noteContent(dashboardNote), this.constants.dashboardBookListTitle);
        console.log("Your Readwise library will be updated to split highlights into sections for faster future updates. This might take a few minutes if you have a large library.");
      }

      const dashboard = {};
      const bookObjectList = this._tableFromMarkdown(dashboardBookListMarkdown);
      const processed = [];
      for (const bookObject of bookObjectList) {
        console.debug("Processing", processed.length, "of", bookObjectList.length, "books");
        await this._ensureBookInDashboardNoteTable(app, dashboard, bookObject);
      }
      await this._writeDashboard(app, dashboard, dashboardNote);

      // Remove the old book list section
      const unsortedContent = this._sectionContent(await this._noteContent(dashboardNote), this.constants.unsortedSectionTitle);
      const unsortedWithoutTable = this._tableStrippedPreambleFromTable(unsortedContent);
      if (unsortedContent.length && (unsortedWithoutTable?.trim()?.length || 0) === 0) {
        await this._replaceContent(dashboardNote, this.constants.unsortedSectionTitle, "");
        dashboardBookListMarkdown = this._sectionContent(await this._noteContent(dashboardNote), this.constants.dashboardBookListTitle);
        try {
          dashboardBookListMarkdown = dashboardBookListMarkdown.replace(new RegExp(`#+\\s${ this.constants.unsortedSectionTitle }[\\r\\n]*`), "");
        } catch (err) {
          if (err.name === "TypeError") throw(new Error("null.replace error on line 479"));
        }
        await this._replaceContent(dashboardNote, this.constants.dashboardBookListTitle, dashboardBookListMarkdown.trim());
        console.log("Successfully migrated books to yearly sections");
      }

      await this._flushLocalNotes(app);
    };

    await doMigrate();
  },

  /*******************************************************************************************
   * Define sort order for books inside the Dashboard tables
   */
  _sortBooks(a, b) {
    // Sort highlights with missing date fields at the bottom
    if (!a.Updated) {
      if (a["Book Title"] < b["Book Title"]) return -1;
      else return 1;
    } else {
      return new Date(b.Updated) - new Date(a.Updated);
    }
  },



  /*******************************************************************************************/
  /* Book notes
  /*******************************************************************************************/

  /*******************************************************************************************
   * Sync highlights for a book into the note provided. This method does all of the propagation from
   * Readwise Highlight object to list of highlights in a note
   *
   * Returns true if successful
   */
  _syncBookHighlights: async function (app, bookNote, readwiseBookID, { readwiseBook = null, throwOnFail = false } = {}) {
    console.log(`_syncBookHighlights(app, ${bookNote}, ${readwiseBookID})`);
    let lastUpdatedAt = await this._getLastUpdatedTimeFromNote(app, bookNote);
    if (this._forceReprocess) {
      lastUpdatedAt = null;
    }

    // Import all (new) highlights from the book
    const noteContent = await this._noteContent(bookNote) || "";

    if (!noteContent.includes("# Summary")) {
      await this._insertContent(bookNote,"# Summary\n");
    }

    if (!readwiseBook) {
      let generator = this._readwiseFetchBooks(app, {bookIdFilter: readwiseBookID});
      let result = await generator.next();
      readwiseBook = result.value;

      if (!readwiseBook) {
        if (throwOnFail) {
          throw new Error(`Could not fetch book details for book ID ${ readwiseBookID }, you were probably rate-limited by Readwise. Please try again in 30-60 seconds?`);
        } else {
          return false;
        }
      }
    }

    const summaryContent = this._bookNotePrefaceContentFromReadwiseBook(app, readwiseBook, bookNote.uuid);
    await this._replaceContent(bookNote, "Summary", summaryContent);

    let highlightsContent = "";
    if (!noteContent.includes("# Highlights")) {
      await this._insertContent(bookNote, "\n# Highlights\n", { atEnd: true });
    } else {
      highlightsContent = this._sectionContent(noteContent, "Highlights");
    }
    let highlights = await this._sectionsFromMarkdown(bookNote, "Highlights", this._loadHighlights);

    let bookNoteHighlightList = await this._bookHighlightsContentFromReadwiseBook(app, readwiseBook, highlights, lastUpdatedAt);
    const sortOrder = app.settings[this.constants.settingSortOrderName] || this.constants.defaultHighlightSort;
    let hlGroups = this._groupByValue(bookNoteHighlightList,
      item => {
        if (!item.highlighted_at) return "No higlight date";
        return this._dateObjectFromDateString(item.highlighted_at).getFullYear();
      },
    );
    hlGroups = this._distributeIntoSmallGroups(app, hlGroups, this.constants.maxBookHighlightsPerSection, this._trimHighlights);
    let entries = Object.entries(hlGroups);
    entries.sort((a, b) => b[0].localeCompare(a[0]));
    let hlMarkdown = this._markdownFromSections(entries, this._markdownFromHighlights(app));

    try {
      await this._replaceContent(bookNote, "Highlights", hlMarkdown);
    } catch (error) {
      console.log("Error replacing", readwiseBook.title, "content, length", hlMarkdown.length ," error", error);
    }

    let existingContent = "";
    if (!noteContent.includes("Sync History")) {
      await this._insertContent(bookNote, "\n# Sync History\n", { atEnd: true });
    } else {
      const match = noteContent.match(/#\sSync\sHistory\n([\s\S]+)$/m);
      existingContent = match ? match[1] : "";
    }

    await this._replaceContent(bookNote, "Sync History",`${ this.constants.updateStringPreface }${ this._localeDateFromIsoDate(app, new Date()) }\n` + existingContent);
    return true;
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
    console.debug(`_ensureBookNote(${ readwiseBook.title })`, baseTag);

    // First, check if the note for this book exists
    const readwiseNotes = await app.filterNotes({ tag: baseTag });
    const bookRegex = new RegExp(`ID\\s?#${ readwiseBook.id }`);
    const searchResults = readwiseNotes.filter(item => bookRegex.test(item.name));
    let bookNote = null;
    if (searchResults.length === 0) {
      const noteTitle = this._noteTitleFromBook(readwiseBook);

      // Create the note if it doesn't exist
      const bookNoteTags = [`${ baseTag }/${ this._textToTagName(readwiseBook.category) }`];
      if (app.settings[this.constants.settingAuthorTag] === "true") {
        const candidateAuthorTag = this._textToTagName(readwiseBook.author);
        const authorTag = candidateAuthorTag && candidateAuthorTag.split("-").slice(0, 3).join("-");
        // Avoid inserting uber-long multi-author tag names that would pollute the tag space
        if (authorTag) bookNoteTags.push(`${ baseTag }/${ authorTag }`);
      }

      bookNote = await app.notes.create(noteTitle, bookNoteTags);
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

  /*******************************************************************************************
   * `book` can be either a highlights LIST from a book, or a book returned by BOOKS list
   */
  _bookNotePrefaceContentFromReadwiseBook(app, book, bookNoteUUID) {
    console.log("_bookNotePrefaceContentFromReadwiseBook", JSON.stringify(book));
    let sourceContent = book.source_url ? `[${ book.source }](${ book.source_url })` : book.source;
    let asinContent = "";
    if (book.asin) {
      if (!book.source.toLowerCase()) console.error("Book ", book.title, "does not have a source?");
      if (book.source?.toLowerCase()?.includes("kindle")) {
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
   * Return a book object to be used in the Dashboard note from a readwiseBook object as returned by Readwise
   * Need to pass the bookNote Amplenote handle for that book in order to return a markdown link to that amplenote
   */
  _bookObjectFromReadwiseBook(app, readwiseBook, bookNoteUUID) {
    console.debug(`_bookObjectFromReadwiseBook(${readwiseBook})`);
    let sourceContent = readwiseBook.source;
    if (sourceContent === "kindle" && readwiseBook.asin) {
      sourceContent = `[${ readwiseBook.source }](kindle://book?action=open&asin=${ readwiseBook.asin })`;
    } else if (readwiseBook.source_url) {
      sourceContent = `[${ readwiseBook.source }](${ readwiseBook.source_url })`;
    }
    return {
      "Cover": `${ readwiseBook.cover_image_url ? `![Book cover](${ readwiseBook.cover_image_url })` : "[No cover image]" }`,
      "Book Title": `[${ readwiseBook.title }](https://www.amplenote.com/notes/${ bookNoteUUID })`,
      "Author": readwiseBook.author || "[No author]",
      "Category": readwiseBook.category || "[No category]",
      "Source": sourceContent || "[No source]",
      "Highlights": `[${ readwiseBook.num_highlights } highlight${ readwiseBook.num_highlights === 1 ? "" : "s" }](https://www.amplenote.com/notes/${ bookNoteUUID }#Highlights})`,
      "Updated": `${ readwiseBook.last_highlight_at ? this._localeDateFromIsoDate(app, readwiseBook.last_highlight_at) : "No highlights" }`,
      // `/bookreview/[\d]+` is used as a regex to grab Readwise book ID from row
      "Other Details": `[Readwise link](https://readwise.io/bookreview/${ readwiseBook.id })`,
    };
  },

  /*******************************************************************************************
   * Return a list of highlight objects from markdown
   */
  _loadHighlights(markdown) {
    let result = [];
    for (let hl of markdown.split("> ###")) {
      let hlObject = {};
      let lines = hl.split("\n");
      hlObject.text = lines[0];

      for (let i = 1; i < lines.length; i++) {
        if (lines[i].startsWith('**Location**:')) {
          hlObject.location = lines[i].substring(14);
        } else if (lines[i].startsWith('**Highlighted at**:')) {
          hlObject.highlighted_at = lines[i].substring(19);
        } else if (lines[i].startsWith('**Note**:')) {
          hlObject.note = lines[i].substring(9);
        } else if (lines[i].startsWith('**Highlight color**:')) {
          hlObject.color = lines[i].substring(20);
        }
      }
      result.push(hlObject);
    }
    return result;
  },

  /*******************************************************************************************
   * Generate the string that should be inserted into the "Highlights" section of a note.
   * Will always return a non-null string
   */
  async _bookHighlightsContentFromReadwiseBook(app, readwiseBook, existingHighlights, lastUpdatedAt) {
    console.log(`Getting all highlights for ${ readwiseBook.title }. Last updated at: ${ lastUpdatedAt }. Existing highlights length: ${ existingHighlights?.length }`);
    // const newHighlightsList = this._getNewHighlightsForBook(app, readwiseBook);
    const newHighlightsList = readwiseBook.highlights;
    let result = [];

    if (newHighlightsList.length) {
      // Highlight IDs were added June 2023, after initial launch. If the plugin content doesn't show existing signs of
      // highlight IDs, we'll replace all highlight content to avoid dupes
      let existingHighlightsContent = existingHighlights.join("\n");
      if (/\(#H[\d]+\)/.test(existingHighlightsContent)) {
        result = newHighlightsList.concat(existingHighlights);
      } else {
        result = newHighlightsList;
      }
    } else {
      result = existingHighlights;
    }
    return result;
  },



  /*******************************************************************************************/
  /* Markdown functions
  /*******************************************************************************************/

  /*******************************************************************************************
   * Return an Amplenote section object given the text of a heading and optionally its level
   */
  _sectionFromHeadingText(headingText, { level = 1 } = {}) {
    return { heading: { text: headingText, level }};
  },

  /*******************************************************************************************
   * Given an object of key: value, create a markdown string where each key is a level 2 heading,
   * and each value is passed through "markdownFunction" as the contents of that heading.
   * 
   * Use this function to convert a dashboard object or a book note object into markdown that can
   * be written to Amplenotes.
   *
   * Necessary mechanism because of Amplenote-side limits on performing writes; splitting into sections
   * allows for smaller write operations.
   */
  _markdownFromSections(sectionEntries, markdownFunction) {
    let markdown = "";
    for (let [key, value] of sectionEntries) {
      markdown += `## ${ key }\n`;
      markdown += markdownFunction(value);
    }
    return markdown;
  },

  /*******************************************************************************************
   * Given a list of highlight objects, return the markdown corresponding to that list.
   */
  _markdownFromHighlights(app) {
    let that = this;
    let subfunction = function(hls) {
      let markdownLines = [];
      for (let hl of hls) {
        let result = "";
        result += `> ### ${ hl.text }\n\n`;
        // TODO: implement location
        if (hl.note) result += `**Note**: ${ hl.note }\n`;
        if (hl.color) result += `**Highlight color**: ${ hl.color }\n`;
        result += `**Highlighted at**: ${ that._localeDateFromIsoDate(app, hl.highlighted_at) } (#H${ hl.id })\n`;
        markdownLines.push(result);
      }
      return markdownLines.join("\n\n");
    };
    return subfunction;
  },

  /*******************************************************************************************
   * Given a list of book items, return a markdown table. Will infer headers from the first 
   * object in that list
   */
  _markdownFromTable() {
    let that = this;
    let subfunction = function(items) {
      let headers = Object.keys(items[0]);
      let markdown = "";

      // Append table headers
      markdown += that._tablePreambleFromHeaders(headers);

      for (let item of items) {
        markdown += that._markdownFromTableRow(headers, item);
      }

      markdown += '\n';
      return markdown;
    };
    return subfunction;
  },

  _tablePreambleFromHeaders(headers) {
    let markdown = "";
    markdown += `| ${ headers.map(item => `**${ item }**`).join(' | ') } |\n`;
    markdown += `| ${ headers.map(() => '---').join(' | ') } |\n`;
    return markdown;
  },

  _markdownFromTableRow(headers, item) {
    let row;
    try {
      row = headers.map(header => item[header].replace(/\|/g, ",") || "");
    } catch (err) {
      if (err.name === "TypeError") throw(new Error("null.replace error on line 824"));
    }
    let markdown = `| ${ row.join(' | ') } |\n`;
    return markdown;
  },

  /*******************************************************************************************
   * Given a note (noteHandle) and a heading name (headingLabel), visit all subsections of the
   * given heading and convert the markdown found in those sections into a list of objects.
   *
   * Returns a flat array of objects (not grouped by their original headings).
   *
   * Calls "entriesFunction" on the found markdown as the markdown-to-object conversion rule.
   */
  async _sectionsFromMarkdown(noteHandle, headingLabel, entriesFunction) {
    console.debug(`_sectionsFromMarkdown(noteHandle, ${ headingLabel }, entriesFunction)`);
    const noteContent = await this._noteContent(noteHandle);
    // This is the book list section
    let mainSectionContent = this._sectionContent(noteContent, headingLabel);
    // These will be year sections
    let sections = this._getHeadingsFromMarkdown(mainSectionContent);

    let result= [];
    
    for (let section of sections) {
      let yearMarkdownContent = this._sectionContent(mainSectionContent, section);
      let entries = entriesFunction(yearMarkdownContent);
      if (!entries) continue;

      result = result.concat(entries);
    }
    return result;
  },

  /*******************************************************************************************
   * Given a markdown table, return a list of objects. Attemps to deal with occasionaly empty 
   * rows that Amplenote sometimes produces when accessing tables.
   *
   * To be used as the parameter for _sectionsFromMarkdown.
   */
  _tableFromMarkdown(content) {
    console.debug(`_tableFromMarkdown(${content})`);

    let lines = content.split('\n');
    if (lines.length < 2) return null;

    // Filter out any empty rows or rows that consist only of dashes or pipes
    lines = lines.filter(row => row.trim() !== "" && !row.trim().match(/^\s*\|([-\s]+\|\s*)+$/));

    let headers;
    try {
      headers = lines[0].split("|")
        .slice(1, -1) // Remove first and last empty strings caused by the leading and trailing |
        .map(header => header.trim().replace(new RegExp("\\*", "g"), ""));
    } catch (err) {
      if (err.name === "TypeError") throw(new Error("null.replace error on line 878"));
    }

    // Convert each row into a JavaScript object where each key is a header
    // and each value is the corresponding cell in the row
    const table = lines.slice(1).map(row => {
      const cells = row.split("|")
      .slice(1, -1) // Remove first and last empty strings caused by the leading and trailing |
      .map(cell => cell.trim());

      const rowObj = {};
      headers.forEach((header, i) => {
          rowObj[header] = cells[i] || null;
      });
      return rowObj;
    });

    return table;
  },

  /*******************************************************************************************
   * Returns a list of Amplenote section objects found in the markdown passed as parameter
   */
  _getHeadingsFromMarkdown(content) {
    const headingMatches = Array.from(content.matchAll(/^#+\s*([^\n]+)/gm));
    try {
      return headingMatches.map(match => ({
        heading: {
          anchor: match[1].replace(/\s/g, "_"),
          level: match[0].match(/^#+/)[0].length,
          text: match[1],
        }
      }));
    } catch (err) {
      if (err.name === "TypeError") throw(new Error("null.replace error on line 912"));
    }
  },

  /*******************************************************************************************
   * Returns a markdown heading string given an Amplenote section object
   */
  _mdSectionFromObject(section) {
    return `${"#".repeat(section.heading.level)} ${section.heading.text}\n`;
  },

  /*******************************************************************************************
   * Legacy, to be replaced: cleans up Amplenote-exported table
   */
  _tableStrippedPreambleFromTable(tableContent) {
    try {
      [
        /^([|\s*]+(Cover|Book Title|Author|Category|Source|Highlights|Updated|Other Details)){1,10}[|\s*]*(?:[\r\n]+|$)/gm,
        /^[|\-\s]+(?:[\r\n]+|$)/gm, // Remove top two rows that markdown tables export as of June 2023
      ].forEach(removeString => {
        tableContent = tableContent.replace(removeString, "").trim();
      tableContent = tableContent.replace(/^#+.*/g, ""); // Remove section label if present
      });
    } catch (err) {
      if (err.name === "TypeError") throw(new Error("null.replace error on line 935"));
    }

    return tableContent;
  },



  /*******************************************************************************************/
  /* Data structures
  /*******************************************************************************************/

  /*******************************************************************************************
   * Given a flat array of objects (toGroup), return an object of key: value, which effectively
   * groups objects from the original array based on a criteria. The criteria is defined by the 
   * "groupFunction" passed as input, which is called on each individual object from the original
   * array. The return value of "groupFunction" is used as the "key", and the "value" will be a 
   * list of objects.
   *
   * Used to group books/highlights into sections corresponding to the year of the last update,
   * but can be used to group by arbitrary properties.
   */
  _groupByValue(toGroup, groupFunction) {
    let result = {};
    for (let item of toGroup) {
      let key = groupFunction(item);
      if (key in result) {
        result[key].push(item);
      } else {
        result[key] = [item];
      }
    }
    return result;
  },

  /*******************************************************************************************
   * Given an object of type group: array, create subgroups of "groupSize" maximum length.
   */
  _distributeIntoSmallGroups(app, source, groupSize, trimFunction) {
    let result = {};
    for (let group of Object.keys(source)) {
      let groupRows = [ ... source[group]];
      let chunks = [];
      while (groupRows.length) {
        let toPush = groupRows.splice(0, groupSize);
        if (trimFunction) {
          toPush = trimFunction(this, app, toPush, groupSize);
        }
        chunks.push(toPush);
      }

      chunks.forEach((chunk, index) => {
        result[`${ group }${ index > 0 ? ' ' + (index + 1) : ''}`] = chunk;
      });
    }
    return result;
  },

  _trimHighlights(_this, app, toPush) {
    let groupMarkdown = _this._markdownFromHighlights(app)(toPush);
    // Preview the markdown that will be generated; is it longer than 100k characters?
    if (groupMarkdown.length < _this.constants.maxReplaceContentLength) return toPush;

    console.log("Trimming highlights for length...");
    // When trimming highlights, trim only those exceeding 100.000 divided by how many 
    //  highlights we have in the group
    const itemTextLimit = _this.constants.maxReplaceContentLength / toPush.length - 
      "> ### \n\n".length - "**Highlighted at**: \n".length - // Subtract the characters that we insert next to the highlight text itself
      " (Trimmed for length)".length - // Subtract the text we add to explain a highlight was trimmed
      30; // Subtract the length of the date string

    for (const item of toPush) {
      if (item.text.length > itemTextLimit) {
        // Remove note and color fields from overflowing highlights
        item.note = null;
        item.color = null;
        item.text = item.text.slice(0, itemTextLimit) + " (Trimmed for length)";
      }
    }
    return toPush;
  },

  
  /*******************************************************************************************/
  /* Amplenote RW
  /*******************************************************************************************/

  /*******************************************************************************************
   * Return all of the markdown within a section that begins with `sectionHeadingText`
   * `sectionHeadingText` Text of the section heading to grab, with or without preceding `#`s
   * `depth` Capture all content at this depth, e.g., if grabbing depth 2 of a second-level heading, this will return all potential h3s that occur up until the next h1 or h2
   */
  _sectionContent(noteContent, headingTextOrSectionObject) {
    console.debug(`_sectionContent()`);
    let sectionHeadingText;
    if (typeof headingTextOrSectionObject === "string") {
      sectionHeadingText = headingTextOrSectionObject;
    } else {
      sectionHeadingText = headingTextOrSectionObject.heading.text;
    }
    try {
      sectionHeadingText = sectionHeadingText.replace(/^#+\s*/, "");
    } catch (err) {
      if (err.name === "TypeError") throw(new Error("null.replace error on line 1039"));
    }
    const { startIndex, endIndex } = this._sectionRange(noteContent, sectionHeadingText);
    return noteContent.slice(startIndex, endIndex);
  },

  /******************************************************************************************
   * All content replacing is routed through this function so that we can swap between interfacing with the note
   * directly, and using local strings for faster replace operations (no image flashing)
   * */
  async _replaceContent(note, sectionHeadingText, newContent, { level = 1 } = {}) {
    console.log(`_replaceContent() with this._useLocalNoteContents=${this._useLocalNoteContents}`);
    const replaceTarget = this._sectionFromHeadingText(sectionHeadingText, { level });
    if (this._useLocalNoteContents) {
      let throughLevel = replaceTarget.heading?.level;
      if (!throughLevel) throughLevel = sectionHeadingText.match(/^#*/)[0].length;
      if (!throughLevel) throughLevel = 1;

      const bodyContent = this._noteContents[note.uuid];
      const { startIndex, endIndex } = this._sectionRange(bodyContent, sectionHeadingText);

      if (startIndex) {
        const revisedContent = `${ bodyContent.slice(0, startIndex) }\n${ newContent }${ bodyContent.slice(endIndex) }`;
        this._noteContents[note.uuid] = revisedContent;
      } else {
        throw new Error(`Could not find section ${ sectionHeadingText } in note ${ note.name }`);
      }
    } else {
      await note.replaceContent(newContent, replaceTarget);
    }
  },

  /*******************************************************************************************
   * Return {startIndex, endIndex} where startIndex is the index at which the content of a section
   * starts, and endIndex the index at which it ends.
   */
  _sectionRange(bodyContent, sectionHeadingText) {
    console.debug(`_sectionRange`);
    const indexes = Array.from(bodyContent.matchAll(this.constants.sectionRegex));
    const sectionMatch = indexes.find(m => m[1].trim() === sectionHeadingText.trim());
    if (!sectionMatch) {
      console.error("Could not find section", sectionHeadingText, "that was looked up. This might be expected");
      return { startIndex: null, endIndex: null };
    } else {
      const level = sectionMatch[0].match(/^#+/)[0].length;
      const nextMatch = indexes.find(m => m.index > sectionMatch.index && m[0].match(/^#+/)[0].length <= level);
      const endIndex = nextMatch ? nextMatch.index : bodyContent.length;
      return { startIndex: sectionMatch.index + sectionMatch[0].length + 1, endIndex };
    }
  },

  /*******************************************************************************************
   * Adds markdown ("newContent") to a "note", optionally at the end of the note ("atEnd" = true).
   * Handles in-memory buffering.
   */
  async _insertContent(note, newContent, { atEnd = false } = {}) {
    if (this._useLocalNoteContents) {
      const oldContent = this._noteContents[note.uuid] || "";
      if (atEnd) {
        this._noteContents[note.uuid] = `${ oldContent.trim() }\n${ newContent }`;
      } else {
        this._noteContents[note.uuid] = `${ newContent.trim() }\n${ oldContent }`;
      }
    } else {
      await note.insertContent(newContent, { atEnd });
    }
  },

  /*******************************************************************************************
   * Returns Amplenote section objects given a note object.
   * Handles in-memory buffering.
   */
  async _sections(note, { minIndent = null } = {}) {
    console.debug(`_sections()`);
    let sections;
    if (this._useLocalNoteContents) {
      const content = this._noteContents[note.uuid];
      sections = this._getHeadingsFromMarkdown(content);
    } else {
      sections = await note.sections();
    }

    if (Number.isInteger(minIndent)) {
      sections = sections.filter(section => (section.heading?.level >= minIndent) && section.heading.text.trim().length) || [];
      return sections;
    } else {
      return sections;
    }

  },

  /*******************************************************************************************
   * Returns the markdown content from a note object.
   * Handles in-memory buffering.
   */
  async _noteContent(note) {
    if (this._useLocalNoteContents) {
      if (typeof this._noteContents[note.uuid] === "undefined") {
        // Don't load too many notes in memory
        if (Object.keys(this._noteContents).length >= this.constants.maxBookLimitInMemory) {
          await this._flushLocalNotes(this._app);
        }
        this._noteContents[note.uuid] = await note.content();
      }
      return this._noteContents[note.uuid];
    } else {
      return await note.content();
    }
  },

  /*******************************************************************************************
   * Write in-memory buffers to amplenotes. Writes section-by-section to avoid maxing out write
   * limits.
   */
  async _flushLocalNotes(app) {
    console.log("_flushLocalNotes(app)");
    for (const uuid in this._noteContents) {
      console.log(`Flushing ${uuid}...`);
      const note = await app.notes.find(uuid);
      let content = this._noteContents[uuid];
      if (!note.uuid.includes("local-")) {
        // The note might be persisted to the sever, in which case its uuid changed
        // In order to properly use the note later, we need to refer to it by its newer uuid
        this._noteContents[note.uuid] = content;
      }
      let newContent = "";

      // Replace note content with section names only, to avoid exceeding Amplenote write limit
      // NOTE: this._useLocaLNoteContents has to be true here; might want to fix this dependency eventually
      let sections = await this._sections(note);
      console.debug(`Inserting sections ${sections.toString()}...`);
      for (const section of sections) {
        newContent = `${newContent}${this._mdSectionFromObject(section)}`;
      }
      await app.replaceNoteContent({uuid: note.uuid}, newContent);

      // Replace individual sections with section content
      sections = this._findLeafNodes(sections);
      for (const section of sections) {
        console.debug(`Inserting individual section content for ${section.heading.text}...`);
        let newSectionContent = this._sectionContent(content, section);
        await app.replaceNoteContent({uuid: note.uuid}, newSectionContent, {section});
      }
      delete this._noteContents[uuid];
      delete this._noteContents[note.uuid];
    }
  },

  /*******************************************************************************************
   * Given a list of heading objects, returns only the ones that are "leafs" (eg. have no 
   * subheadings.
   */
  _findLeafNodes(depths) {
    let leafNodes = [];

    for (let i = 0; i < depths.length - 1; i++) {
      if (depths[i + 1].heading.level <= depths[i].heading.level) {
        leafNodes.push(depths[i]);
      }
    }

    // Add the last node if it's not already included (it's a leaf by default)
    if (depths.length > 0 && (leafNodes.length === 0 || leafNodes[leafNodes.length - 1].heading.level !== depths.length - 1)) {
      leafNodes.push(depths[depths.length - 1]);
    }

    return leafNodes;
  },

  /*******************************************************************************************
   * Transform text block to lower-cased dasherized text
   */
  _textToTagName(text) {
    console.log("_textToTagName", text);
    if (!text) return null;
    try {
      return text.toLowerCase().trim().replace(/[^a-z0-9\/]/g, "-");
    } catch (err) {
      if (err.name === "TypeError") throw(new Error("null.replace error on line 1217"));
    }
  },



  /*******************************************************************************************/
  /* Date manipulation
  /*******************************************************************************************/

  /*******************************************************************************************
   * Returns human-friendly date string from date object.
   */
  _localeDateFromIsoDate(app, dateStringOrObject) {
    console.debug(`_localeDateFromIsoDate(app, ${dateStringOrObject}`);
    try {
      if (!dateStringOrObject) return "";
      const dateObject = new Date(dateStringOrObject);
      const dateFormat = this._dateFormat || (app && app.settings[this.constants.settingDateFormat]) || "en-US";
      let result = dateObject.toLocaleDateString(dateFormat, { month: "long", day: "numeric", year: "numeric" });
      const recentDateCutoff = (new Date()).setDate((new Date()).getDate() - 3);
      if (dateObject > recentDateCutoff) {
        result += " " + dateObject.toLocaleTimeString(dateFormat, { hour: "numeric", minute: "2-digit", hour12: true });
      }
      return result;
    } catch (e) {
      console.error("There was an error parsing your date string", dateStringOrObject, e);
      return dateStringOrObject;
    }
  },

  /*******************************************************************************************
   * A regular expression whose [1] match will be the "Updated at" string
   */
  _updateStampRegex() {
    return new RegExp(`^(?:\\|[^|]*){${ this._columnsBeforeUpdateDate }}\\|\\s*([^|]+)\\s*\\|.*(?:$|[\\r\\n]+)`, "gm");
  },

  /*******************************************************************************************
   * `dateString` a string like January 1, 2023 at 5:00pm
   */
  _dateObjectFromDateString(dateString) {
    console.log("_dateObjectFromDateString", dateString);
    if (!dateString) return null;
    let parseableString;
    try {
      parseableString = dateString.toLowerCase().replace(/\s?[ap]m/, "").replace(" at ", " ");
    } catch (err) {
      if (err.name === "TypeError") throw(new Error("null.replace error on line 1264"));
    }
    const parsedDate = Date.parse(parseableString);
    if (parsedDate) {
      return new Date(parsedDate);
    } else {
      return null;
    }
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
    const dateLine = lines.find(line => line.includes(this.constants.updateStringPreface));
    let result = null;
    if (dateLine) {
      let dateString;
      try {
        dateString = dateLine.replace(this.constants.updateStringPreface, "");
        if (dateString.includes("pm")) {
          const hourMatch = dateString.match(/at\s([\d]{1,2}):/);
          if (hourMatch) {
            dateString = dateString.replace(` ${ hourMatch[1] }:`, ` ${ parseInt(hourMatch[1]) + 12 }:`);
          } else {
            console.error("Error parsing dateString");
          }
        }
      } catch (err) {
        if (err.name === "TypeError") throw(new Error("null.replace error on line 1303"));
      }
      const result = this._dateObjectFromDateString(dateString);
      if (!result || isNaN(result.getTime())) {
        console.log("Could not ascertain date from", dateLine, "and dateString", dateString);
        return null;
      }
    } else {
      console.log("Couldn't find a line containing the update time for note", noteHandle.uuid);
    }

    if (result) console.debug(`Last updated detected: ${ result.getTime() }`);
    return result;
  },



  /*******************************************************************************************/
  /* Readwise APIs
  /*******************************************************************************************/

  async* _testLongReadwiseFetchBooks(app, {bookIdFilter=null, categoryFilter=null, dateFilter=null} = {}) {
    // TODO: add this as an automated test, please
    let hls = [...Array(10).keys()];
    hls = hls.map(item => ({
					"id": item,
					"text": "a".repeat(10000),
					"location": 1,
					"location_type": "order",
					"note": null,
					"color": "yellow",
					"highlighted_at": "2022-09-13T16:41:53.186Z",
					"created_at": "2022-09-13T16:41:53.186Z",
					"updated_at": "2022-09-14T18:50:30.564Z",
					"external_id": "6320b2bd7fbcdd7b0c000b3e",
					"end_location": null,
					"url": null,
					"book_id": 123,
					"tags": [],
					"is_favorite": false,
					"is_discard": false,
					"readwise_url": "https://readwise.io/open/456"
				}));
    yield {
			"user_book_id": 123,
			"title": "Some title",
			"author": "Some author",
			"readable_title": "Some title",
			"source": "raindrop",
			"cover_image_url": "https://cover.com/image.png",
			"unique_url": "",
			"book_tags": [],
			"category": "articles",
			"document_note": "",
			"readwise_url": "https://readwise.io/bookreview/123",
			"source_url": "",
			"asin": null,
			"highlights": hls,
    };
  },

  /*******************************************************************************************
   * Returns the `book` json object from Readwise. Currently contains keys for [id, title, author, category, source,
   * cover_image_url], and other stuff enumerated at https://readwise.io/api_deets under "Books LIST"
   */
  async* _readwiseFetchBooks(app, {bookIdFilter=null, categoryFilter=null, dateFilter=null} = {}) {
    const url = new URL(`${ this.constants.readwiseExportURL }`);
    if(bookIdFilter) url.searchParams.append("ids", bookIdFilter);
    // Only apply date filters if we're fetching ALL types of books
    if(dateFilter && !categoryFilter) url.searchParams.append("updatedAfter", dateFilter);
    for await (const item of this._readwisePaginateExportRequest(app, url)) {
      if (categoryFilter && item.category !== categoryFilter) continue;
      yield item;
    }
  },

  /*******************************************************************************************
   * Handles pagination for the /export Readwise API. Generator.
   */
  async* _readwisePaginateExportRequest(app, url) {
    let nextPage = false;

    while (true) {
      if (nextPage) url.searchParams.set("pageCursor", nextPage);
      const data = await this._readwiseMakeRequest(app, url);
      if (data) {
        for (const item of data.results) {
          if (this._abortExecution) break;

          // Update fields such because Readwise's EXPORT returns slightly different names than LIST
          item.id = item.user_book_id;
          item.num_highlights = item.highlights.length;

          // Sort highlights by date descending
          let hls = item.highlights;
          hls = hls.sort((a, b) => {
            // Sort highlights with missing date fields at the bottom
            if (a.highlighted_at === undefined) return 1;
            if (b.highlighted_at === undefined) return -1;
            return new Date(b.highlighted_at) - new Date(a.highlighted_at);
          });
          item.highlights = hls;
          item.last_highlight_at = null;
          if (hls[0]) item.last_highlight_at = hls[0].highlighted_at;

          yield item;
        }
        nextPage = data.nextPageCursor;
        if (!nextPage) break;
      } else {
        console.error("Breaking from pagination loop due to no response from request", url);
        break;
      }
    }
  },

  /*******************************************************************************************
   * Returns a generator of highlights, given a book ID
   */
  async* _readwiseGetAllHighlightsForBook(app, bookId, updatedAfter) {
    console.log(`_readwiseGetAllHighlightsForBook(app, ${ bookId }, ${ updatedAfter })`);
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
      if (data) {
        for (const item of data.results) {
          if (this._abortExecution) break;
          yield item;
        }
        hasNextPage = data.next !== null;
      } else {
        console.error("Breaking from pagination loop due to no response from request", baseUrl);
        break;
      }
      currentPage++;
    }
  },

  /*******************************************************************************************
   * Makes a request to Readwise, adds authorization Headers from app.settings.
   * Returns the response.json() object of the request.
   */
  async _readwiseMakeRequest(app, url) {
    console.log(`_readwiseMakeRequest(app, ${url.toString()})`);
    const readwiseAPIKey = app.settings["Readwise Access Token"];
    if (!readwiseAPIKey || readwiseAPIKey.trim() === '') {
      throw new Error('Readwise API key is empty. Please provide a valid API key.');
    }

    const headers = new Headers({ "Authorization": `Token ${ readwiseAPIKey }`, "Content-Type": 'application/json' });

    // Wait to ensure we don't exceed the requests/minute quota of Readwise
    await this._ensureRequestDelta(app);

    // Use a proxy until Readwise adds CORS preflight headers
    const proxyUrl = `https://amplenote-readwise-cors-anywhere.onrender.com/${ url.toString() }`;
    const tryFetch = async () => {
      const response = await fetch(proxyUrl, { method: 'GET', headers });

      if (!response.ok) {
        console.error(`HTTP error. Status: ${ response.status }`);
        return null;
      } else {
        return response.json();
      }
    };

    try {
      let result = await tryFetch();
      if (result) {
        return result;
      } else {
        console.error("Null result trying fetch. Sleeping before final retry");
        await new Promise(resolve => setTimeout(resolve,this.constants.sleepSecondsAfterRequestFail * 1000));
        return await tryFetch();
      }
    } catch (e) {
      console.trace();
      console.error("Handling", e, "stack", e.stack);
      app.alert("Error making request to Readwise", e);
      return null;
    }
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
        const alertMessage = `Waiting for ${ Math.floor(waitTime / 1000) } seconds to satisfy Readwise API limit...\n\n` +
          `You can wait here, or click "DONE" to dismiss, and we will update notes in the background as you work. ⏳\n\n` +
          `Working concurrently while notes are being changed could lead to merge issues, so we recommend minimizing note changes while a sync is underway.`;
        const response = await app.alert(alertMessage, { actions: [ { label: "Cancel sync", icon: "close" } ]});

        if (response === 0) {
          console.debug("User cancelled sync");
          this._abortExecution = true;
        } else {
          await new Promise((resolve) => setTimeout(resolve, waitTime)); // Wait for the remaining time before making the next request
          this._requestsCount = 0; // Reset the request count after waiting
        }
      }
    }
    this._lastRequestTime = currentTime; // Update the last request time to the current time
    this._requestsCount++; // Increment the request count
  },

  /*******************************************************************************************/
  _initialize(app) {
    this._abortExecution = false;
    this._columnsBeforeUpdateDate = 6; // So, this is the 7th column in a 1-based table column array
    this._columnsBeforeTitle = 1;
    this._dateFormat = null;
    this._forceReprocess = false;
    this._lastRequestTime = null;
    this._noteContents = {};
    this._requestsCount = 0;
    this._app = app;
    // When doing mass updates, it's preferable to work with the string locally and replace the actual note content
    // less often, since each note content replace triggers a redraw of the note table & all its per-row images.
    // When this is enabled (globally, or for a particular method), the locally-manipulated note contents must be
    // flushed to the actual note content via this._flushLocalNotes(app) before the method returns.
    this._useLocalNoteContents = false;
    if (this._testEnvironment === undefined) this._testEnvironment = false;
  }
}
export default plugin;
