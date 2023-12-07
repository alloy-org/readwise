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
import { _sectionsFromMarkdown,
  _tableFromMarkdown,
} from './markdown.js';
import { _groupByValue } from './data_structures.js';
import * as readwise from './readwise.js';
import { _ensureBookNote,
  _bookObjectFromReadwiseBook,
  _syncBookHighlights,
} from './books.js';

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

      const updateThrough = details.lastUpdated;
      const dateFormat = this._dateFormat || (app && app.settings[this.constants.settingDateFormat]) || "en-US";
      let dateFilter = null;
      if (updateThrough) {
        dateFilter = new Date(Date.parse(updateThrough));
        dateFilter = dateFilter.toISOString().slice(0, -1) + 'Z';
        console.log("Looking for results after", updateThrough, "submitting as", dateFilter);
      }
      dashboardNoteContents = await _noteContent(this._noteContents, dashboardNote);
      let dashboard = await _sectionsFromMarkdown(dashboardNoteContents, this.constants.dashboardConstants.dashboardBookListTitle, _tableFromMarkdown);
      dashboard = _groupByValue(dashboard,
        item => {
          return _sectionNameFromLastHighlight(item.Updates);
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
        const success = await _syncBookHighlights(app, this._noteContents, this._forceReprocess, this.readwiseModule._readwiseFetchBooks, this.constants, dateFormat, bookNote, readwiseBook.id, { readwiseBook });
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
      const dateFormat = this._dateFormat || (app && app.settings[this.constants.settingDateFormat]) || "en-US";
      const success = await _syncBookHighlights(app, this._noteContents, this._forceReprocess, this.readwiseModule._readwiseFetchBooks, this.constants, dateFormat, currentNote, bookId, { throwOnFail: true });
      if (this._useLocalNoteContents) {
        await _flushLocalNotes(app);
      }
      if (success) {
        await app.alert("✅ Book highlights fetched successfully!");
      }
    } catch (error) {
      await app.alert(String(error));
    }
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
            options: categories.map(function(value, index) {
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
    // flushed to the actual note content via _flushLocalNotes(app) before the method returns.
    this._useLocalNoteContents = false;
    if (this._testEnvironment === undefined) this._testEnvironment = false;
  }
};
export default plugin;
