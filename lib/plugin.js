import 'fs';
import { _migrateBooksToSections,
  _loadDetails,
  _updateDashboardDetails,
  _ensureBookInDashboardNoteTable,
  _writeDetails,
  _writeDashboard,
  _sectionNameFromLastHighlight,
} from './dashboard.js';
import { _noteContent,
  _sectionContent,
  _insertContent,
  _replaceContent,
  _flushLocalNotes,
} from './amplenote_rw.js';
import {
  _markdownFromHighlights,
  _markdownFromSections, _sectionsFromMarkdown,
  _tableFromMarkdown,
} from './markdown.js';
import {_distributeIntoSmallGroups, _groupByValue, _trimHighlights} from './data_structures.js';
import * as readwise from './readwise.js';
import {
  _ensureBookNote,
  _bookObjectFromReadwiseBook,
  _bookNotePrefaceContentFromReadwiseBook,
  _loadHighlights,
  _bookHighlightsContentFromReadwiseBook,
} from './books.js';
import {_getLastUpdatedTimeFromNote, _localeDateFromIsoDate, _yearFromDateString} from "./dates.js";

const plugin = {
  // TODO: handle abort execution
  // TODO: add conditions to plugin actions
  constants: {
    dashboardLibraryDetailsHeading: "Library Details",
    dashDetails: {
      lastSyncedAt: "Last synced at",
      firstUpdated: "Oldest update synced in",
      lastUpdated: "Next sync for content updated after",
      booksImported: "Readwise books imported into table",
      booksReported: "Book count reported by Readwise",
    },
    dashboardConstants: {
      maxTableBooksPerSection: 20,
      defaultDashboardNoteTitle: "Readwise Library Dashboard",
      unsortedSectionTitle: "Books pending sort",
      dashboardBookListTitle: "Readwise Book List",
    },
    readwiseConstants: {
      rateLimit: 20, // Max requests per minute (20 is Readwise limit for Books and Highlights APIs)
      readwiseBookDetailURL: bookId => `https://readwise.io/api/v2/books/${ bookId }`,
      readwiseBookIndexURL: "https://readwise.io/api/v2/books",
      readwiseExportURL: "https://readwise.io/api/v2/export",
      readwiseHighlightsIndexURL: "https://readwise.io/api/v2/highlights",
      readwisePageSize: 1000, // Highlights and Books both claim they can support page sizes up to 1000 so we'll take them up on that to reduce number of requests we need to make
      sleepSecondsAfterRequestFail: 10,
    },
    bookConstants: {
      defaultBaseTag: "library",
      defaultHighlightSort: "newest",
      maxBookHighlightsPerSection: 10,
      settingAuthorTag: "Save authors as tags (\"true\" or \"false\". Default: false)",
      settingSortOrderName: "Highlight sort order (\"newest\" or \"oldest\". Default: newest)",
      settingTagName: "Base tag for Readwise notes (Default: library)",
      updateStringPreface: "- Highlights updated at: ",
      maxReplaceContentLength: 100000, // Empirically derived
    },
    maxBookLimitInMemory: 20,
    maxHighlightLimit: 5000,
    maxBookLimit: 500,
    settingDateFormat: "Date format (default: en-US)",
    settingDiscardedName: "Import discarded highlights (\"true\" or \"false\". Default: false)",
    settingMaxBookCount: "Maximum number of books/sources to import (default: 500)",
  },

  readwiseModule: undefined,

  appOption: {
    /*******************************************************************************************
     * Fetches all books found in Readwise. Creates a note per book.
     */
    "Sync all": async function (app) {
      this._initialize(app);
      this._useLocalNoteContents = true;
      await this._syncAll(app);
    },

    /*******************************************************************************************
     * Fetches all items of a certain category. Creates a note per item.
     */
    "Sync only...": async function(app) {
      this._initialize(app);
      this._useLocalNoteContents = true;
      await this._syncOnly(app);
    },
  },

  noteOption: {
    /*******************************************************************************************
     * Syncs newer highlights for an individual book.
     * Fails if the note title doesn't match the required template.
     */
    "Sync this book": {
      run: async function(app, noteUUID) {
        this._initialize(app);
        this._useLocalNoteContents = true;
        await this._syncThisBook(app, noteUUID);
      },

      /*
       * Only show the option to sync a book if the note title has the expected format and tag applied
       */
      check: async function(app, noteUUID) {
        const noteObject = await app.findNote({uuid: noteUUID});
        const noteTitle = noteObject.name;
        const bookTitleRegExp = new RegExp(".*\(ID #[0-9]+\)");
        if (!bookTitleRegExp.test(noteTitle)) return false;
        for (const tag of noteObject.tags) {
          if (tag.startsWith(app.settings[this.constants.bookConstants.settingTagName] ||
              this.constants.bookConstants.defaultBaseTag)) return true;
        }
        return false;
      },
    }
  },

  /*******************************************************************************************/
  /* Main entry points
  /*******************************************************************************************/
  async _syncAll(app, categoryFilter) {
    console.log("Starting sync all", new Date());
    try {
      const dashboardNoteTitle = app.settings[`Readwise dashboard note title (default: ${ this.constants.dashboardConstants.defaultDashboardNoteTitle })`] ||
        this.constants.dashboardConstants.defaultDashboardNoteTitle;

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

      // Ensure that dashboardNote exists in a state where await _noteContent(dashboardNote) can be called on it
      const baseTag = app.settings[this.constants.bookConstants.settingTagName] ||
          this.constants.bookConstants.defaultBaseTag;
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
          if (err.name === "TypeError") {
            throw(new Error(`${ err.message } (line (141)`));
          }
        }

        const navigateUrl = `${ origin }/notes/${ dashboardNote.uuid }`;
        await app.navigate(navigateUrl);
      }

      let bookCount = 0;

      await _migrateBooksToSections(app, this._noteContents, dashboardNote, this.constants.dashboardConstants);



      let dashboardNoteContents = await _noteContent(this._noteContents, dashboardNote);
      const details = _loadDetails(_sectionContent(dashboardNoteContents, this.constants.dashboardLibraryDetailsHeading));
      if (!dashboardNoteContents.includes(this.constants.dashboardLibraryDetailsHeading)) {
        await _insertContent(this._noteContents, dashboardNote, "# " + this.constants.dashboardLibraryDetailsHeading + "\n");
      }
      if (!dashboardNoteContents.includes(this.constants.dashboardConstants.dashboardBookListTitle)) {
        // Add a header to the dashboard note if it doesn't exist
        // Edits dashboard note
        await _insertContent(this._noteContents, dashboardNote, `# ${ this.constants.dashboardConstants.dashboardBookListTitle }\n`, { atEnd: true });
      }

      const updateThrough = details[this.constants.dashDetails.lastUpdated];
      const dateFormat = this._dateFormat || (app && app.settings[this.constants.settingDateFormat]) || "en-US";
      let dateFilter = null;
      if (updateThrough && Date.parse(updateThrough)) {
        dateFilter = new Date(Date.parse(updateThrough));
        dateFilter = dateFilter.toISOString().slice(0, -1) + 'Z';
        console.log("Looking for results after", updateThrough, "submitting as", dateFilter);
      }
      dashboardNoteContents = await _noteContent(this._noteContents, dashboardNote);
      let dashboard = await _sectionsFromMarkdown(dashboardNoteContents, this.constants.dashboardConstants.dashboardBookListTitle, _tableFromMarkdown);
      dashboard = _groupByValue(dashboard,
        item => {
          return _sectionNameFromLastHighlight(item.Updated);
        },
      );
      let readwiseBookCount = await this.readwiseModule._getReadwiseBookCount(app, this.constants.readwiseConstants);
      if (readwiseBookCount) {
        await _updateDashboardDetails(app, dashboard, this.constants.dashDetails, dateFormat, details, { bookCount: readwiseBookCount });
      }

      for await (const readwiseBook of this.readwiseModule._readwiseFetchBooks(app, this.constants.readwiseConstants, {dateFilter, categoryFilter})) {
        if (this._abortExecution) break;
        if (!readwiseBook) continue;
        if (bookCount >= this.constants.maxBookLimit) break;

        const bookNote = await _ensureBookNote(app, this.constants.bookConstants, readwiseBook, dashboardNote);
        const bookObject = _bookObjectFromReadwiseBook(readwiseBook, bookNote.uuid, dateFormat);
        
        // Edits dashboard object
        await _ensureBookInDashboardNoteTable(app, dashboard, bookObject);

        // Edits book note
        if (typeof this._noteContents[bookNote.uuid] === "undefined") {
          // Don't load too many notes in memory
          if (Object.keys(this._noteContents).length >= this.constants.maxBookLimitInMemory) {
            await _flushLocalNotes(app, this._noteContents);
          }
        }
        const success = await this._syncBookHighlights(app, bookNote, readwiseBook.id, { readwiseBook });
        if (success) bookCount += 1;
      }
      // Edits dashboard note
      // Let's load it again just in case it was deleted in previous flush notes
      // TODO: fixme
      await _noteContent(this._noteContents, dashboardNote);
      let tableRowCount = Object.values(dashboard).reduce((total, curr) => total + curr.length, 0);
      await _updateDashboardDetails(app, dashboard, this.constants.dashDetails, dateFormat, details, {tableRowCount});
      let markdownDetails = _writeDetails(details);
      await _replaceContent(this._noteContents, dashboardNote, this.constants.dashboardLibraryDetailsHeading, markdownDetails);

      await _writeDashboard(app, this._noteContents, dashboard, dashboardNote, this.constants.dashboardConstants);
      await _flushLocalNotes(app, this._noteContents);
      if (this._abortExecution) {
        await app.alert(`✅️ ${ bookCount } book${ bookCount === "1" ? "" : "s" } refreshed before canceling sync.`);
      } else {
        await app.alert(`✅ ${ bookCount } book${ bookCount === "1" ? "" : "s" } fetched & refreshed successfully!`);
      }
    } catch (error) {
      if (this._testEnvironment) {
        console.log(error);
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
      await _flushLocalNotes(app, this._noteContents);
      if (success) {
        await app.alert("✅ Book highlights fetched successfully!");
      }
    } catch (error) {
      await app.alert(String(error));
      throw(error);
    }
  },

  /*******************************************************************************************
   * Sync highlights for a book into the note provided. This method does all of the propagation from
   * Readwise Highlight object to list of highlights in a note
   *
   * Returns true if successful
   */
  async _syncBookHighlights(app, bookNote, readwiseBookID, { readwiseBook = null, throwOnFail = false } = {}) {
    console.log(`_syncBookHighlights(app, ${bookNote}, ${readwiseBookID})`);
    const dateFormat = this._dateFormat || (app && app.settings[this.constants.settingDateFormat]) || "en-US";
    let lastUpdatedAt = await _getLastUpdatedTimeFromNote(app, this.constants, bookNote);
    if (this._forceReprocess) {
      lastUpdatedAt = null;
    }

    // Import all (new) highlights from the book
    const noteContent = await _noteContent(this._noteContents, bookNote) || "";

    if (!noteContent.includes("# Summary")) {
      await _insertContent(this._noteContents, bookNote, "# Summary\n");
    }

    if (!readwiseBook) {
      let generator = this.readwiseModule._readwiseFetchBooks(app, this.constants.readwiseConstants, {bookIdFilter: readwiseBookID});
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

    const summaryContent = _bookNotePrefaceContentFromReadwiseBook(app, this.constants.bookConstants, dateFormat, readwiseBook, bookNote.uuid);
    await _replaceContent(this._noteContents, bookNote, "Summary", summaryContent);

    let highlightsContent = "";
    if (!noteContent.includes("# Highlights")) {
      await _insertContent(this._noteContents, bookNote, "\n# Highlights\n", { atEnd: true });
    } else {
      highlightsContent = _sectionContent(noteContent, "Highlights");
    }
    let highlights = await _sectionsFromMarkdown(noteContent, "Highlights", _loadHighlights);

    let bookNoteHighlightList = await _bookHighlightsContentFromReadwiseBook(app, readwiseBook, highlights, lastUpdatedAt);
    // const sortOrder = app.settings[constants.bookConstants.settingSortOrderName] || constants.bookConstants.defaultHighlightSort;
    let hlGroups = _groupByValue(bookNoteHighlightList,
        item => {
          if (!item.highlighted_at) return "No higlight date";
          let year = _yearFromDateString(item.highlighted_at);
          if (!year) return "No highlight date";
          return year;
        },
    );
    hlGroups = _distributeIntoSmallGroups(hlGroups, this.constants.bookConstants.maxBookHighlightsPerSection,
        this.constants.bookConstants.maxReplaceContentLength, _trimHighlights, dateFormat);
    let entries = Object.entries(hlGroups);
    entries.sort((a, b) => b[0].localeCompare(a[0]));
    let hlMarkdown = _markdownFromSections(app, entries, _markdownFromHighlights.bind(this));

    try {
      await _replaceContent(this._noteContents, bookNote, "Highlights", hlMarkdown);
    } catch (error) {
      console.log("Error replacing", readwiseBook.title, "content, length", hlMarkdown.length ," error", error);
    }

    let existingContent = "";
    if (!noteContent.includes("Sync History")) {
      await _insertContent(this._noteContents, bookNote, "\n# Sync History\n", { atEnd: true });
    } else {
      const match = noteContent.match(/#\sSync\sHistory\n([\s\S]+)$/m);
      existingContent = match ? match[1] : "";
    }

    await _replaceContent(this._noteContents, bookNote, "Sync History",`${ this.constants.bookConstants.updateStringPreface }${ _localeDateFromIsoDate(new Date(), dateFormat) }\n` + existingContent);
    return true;
  },

  /*******************************************************************************************/
  async _syncOnly(app) {
    try {
      // As per docs: category is one of books, articles, tweets, supplementals or podcasts
      const categories = ["books", "articles", "tweets", "supplementals", "podcasts"];
      let result = await app.prompt(
        "What category of highlights would you like to sync?", {
          inputs: [{
            type: "select",
            label: "Category",
            options: categories.map(function(value) {
              return { value: value, label: value };
            })
          }]
        }
      );
      if (result) await this._syncAll(app, result);
    } catch (err) {
      app.alert(err);
    }
  },

  /*******************************************************************************************/
  _initialize(app, readwiseModule) {
    if(readwiseModule) this.readwiseModule = readwiseModule;
    else this.readwiseModule = readwise;

    this._abortExecution = false;
    this._columnsBeforeUpdateDate = 6; // So, this is the 7th column in a 1-based table column array
    // this._columnsBeforeTitle = 1;
    this._dateFormat = null;
    this._forceReprocess = false;
    this._noteContents = {};
    this._app = app;
    if (app && app.settings[this.constants.settingMaxBookCount]) {
      this.constants.maxBookLimit = app.settings[this.constants.settingMaxBookCount];
    } else {
      this.constants.maxBookLimit = 500;
    }
    // When doing mass updates, it's preferable to work with the string locally and replace the actual note content
    // less often, since each note content replace triggers a redraw of the note table & all its per-row images.
    // When this is enabled (globally, or for a particular method), the locally-manipulated note contents must be
    // flushed to the actual note content via _flushLocalNotes(app) before the method returns.
    this._useLocalNoteContents = false;
    if (this._testEnvironment === undefined) this._testEnvironment = false;
  }
};
export default plugin;
