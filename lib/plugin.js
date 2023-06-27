const plugin = {
  constants: {
    booksImportedLabel: "Readwise books imported into table",
    defaultBaseTag: "library",
    dashboardBookListTitle: "Readwise Book List",
    defaultDashboardNoteTitle: "Readwise Library Dashboard",
    defaultHighlightSort: "newest",
    dashboardLibraryDetailsHeading: "Library Details",
    firstUpdatedContentLabel: "Oldest update synced in: ",
    lastUpdatedContentLabel: "Next sync for content updated after: ",
    maxReplaceContentLength: 100000, // Empirically derived
    maxHighlightLimit: 5000,
    rateLimit: 20, // Max requests per minute (20 is Readwise limit for Books and Highlights APIs)
    readwiseBookDetailURL: bookId => `https://readwise.io/api/v2/books/${ bookId }`,
    readwiseBookIndexURL: "https://readwise.io/api/v2/books",
    readwiseHighlightsIndexURL: "https://readwise.io/api/v2/highlights",
    readwisePageSize: 1000, // Highlights and Books both claim they can support page sizes up to 1000 so we'll take them up on that to reduce number of requests we need to make
    sectionRegex: /^#+\s*([^#\n\r]+)/gm,
    settingAuthorTag: "Save authors as tags (\"true\" or \"false\". Default: true)",
    settingDateFormat: "Date format (default: en-US)",
    settingDiscardedName: "Import discarded highlights (\"true\" or \"false\". Default: false)",
    settingSortOrderName: "Highlight sort order (\"newest\" or \"oldest\". Default: newest)",
    settingTagName: "Base tag for Readwise notes (Default: library)",
    sleepSecondsAfterRequestFail: 10,
    updateStringPreface: "- Highlights updated at: ",
    unsortedSectionTitle: "Books pending sort",
  },

  noteOption: {
    /*******************************************************************************************
     * Fetches all books found in Readwise. Creates a note per book.
     */
    "Sync all": async function (app, noteUUID) {
      this._initialize();
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
        })

        // Ensure that dashboardNote exists in a state where await this._noteContent(dashboardNote) can be called on it
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

        await this._migrateBooksToSections(app, dashboardNote);

        let dashboardNoteContents = await this._noteContent(dashboardNote);
        if (!dashboardNoteContents.includes(this.constants.dashboardBookListTitle)) {
          // Add a header to the dashboard note if it doesn't exist
          await this._insertContent(dashboardNote, `# ${ this.constants.dashboardBookListTitle }\n`, { atEnd: true });
        }

        // Fetch a book, create its note and add its highlights
        for await (const direction of [ "forward", "backward" ]) {
          for await (const readwiseBook of this._readwiseFetchBooks(app, dashboardNote, direction)) {
            if (this._abortExecution) break;
            if (!readwiseBook) continue;

            const bookNote = await this._ensureBookNote(app, readwiseBook, dashboardNote);
            const bookRowContent = this._bookRowContentFromReadwiseBook(app, readwiseBook, bookNote.uuid);
            await this._ensureBookInDashboardNoteTable(app, dashboardNote, bookRowContent);
            await this._updateDashboardDetails(app, dashboardNote, await this._noteContent(dashboardNote));
            const success = await this._syncBookHighlights(app, bookNote, readwiseBook.id, { readwiseBook });
            if (success) bookCount += 1;
          }

          console.log("Finished traverse in", direction, "direction");
          if (this._abortExecution) break;
        }

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
      }
    },

    /*******************************************************************************************
     * Syncs newer highlights for an individual book.
     * Fails if the note title doesn't match the required template.
     */
    "Sync this book": async function (app, noteUUID) {
      this._initialize();
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
          await app.alert("✅ Book highlights fetched successfully!")
        }
      } catch (error) {
        await app.alert(String(error));
      }
    },
  },

  /*******************************************************************************************
   * Sync highlights for a book into the note provided. This method does all of the propagation from
   * Readwise Highlight object to list of highlights in a note
   *
   * Returns true if successful
   */
  _syncBookHighlights: async function (app, bookNote, readwiseBookID, { readwiseBook = null, throwOnFail = false } = {}) {
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
      readwiseBook = await this._readwiseMakeRequest(app, this.constants.readwiseBookDetailURL(readwiseBookID));
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

    let bookNoteHighlightContent = await this._bookHighlightsContentFromReadwiseBook(app, readwiseBook, highlightsContent || "", lastUpdatedAt);
    try {
      if (bookNoteHighlightContent.length > this.constants.maxReplaceContentLength) {
        // Not sure yet how best to deal with notes that have more than 100,000 characters of Highlight content.
        console.error("Truncating highlight content by", this.constants.maxReplaceContentLength - bookNoteHighlightContent.length, "characters");
        bookNoteHighlightContent = bookNoteHighlightContent.slice(0, this.constants.maxReplaceContentLength - 4) + " ...";
      }
      await this._replaceContent(bookNote, "Highlights", bookNoteHighlightContent);
    } catch (error) {
      console.log("Error replacing", readwiseBook.title, "content, length", bookNoteHighlightContent.length ," error", error);
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
    console.log(`_ensureBookNote(${ readwiseBook.title })`, baseTag);

    // First, check if the note for this book exists
    const readwiseNotes = await app.filterNotes({ tag: baseTag });
    const bookRegex = new RegExp(`ID\\s?#${ readwiseBook.id }`);
    const searchResults = readwiseNotes.filter(item => bookRegex.test(item.name));
    let bookNote = null;
    if (searchResults.length === 0) {
      const noteTitle = this._noteTitleFromBook(readwiseBook);

      // Create the note if it doesn't exist
      const bookNoteTags = [`${ baseTag }/${ this._textToTagName(readwiseBook.category) }`];
      if (app.settings[this.constants.settingAuthorTag] !== "false") {
        bookNoteTags.push(`${ baseTag }/${ this._textToTagName(readwiseBook.author) }`);
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

  /*******************************************************************************************/
  _sectionFromHeadingText(headingText, { level = 1 } = {}) {
    return { section: { heading: { text: headingText, level }}};
  },

  /*******************************************************************************************
   * Return all of the markdown within a section that begins with `sectionHeadingText`
   * `sectionHeadingText` Text of the section heading to grab, with or without preceding `#`s
   * `depth` Capture all content at this depth, e.g., if grabbing depth 2 of a second-level heading, this will return all potential h3s that occur up until the next h1 or h2
   */
  _sectionContent(noteContent, headingTextOrSectionObject) {
    let sectionHeadingText;
    if (typeof headingTextOrSectionObject === "string") {
      sectionHeadingText = headingTextOrSectionObject;
    } else {
      sectionHeadingText = headingTextOrSectionObject.section.heading.text;
    }
    sectionHeadingText = sectionHeadingText.replace(/^#+\s*/, "");
    const { startIndex, endIndex } = this._sectionRange(noteContent, sectionHeadingText);
    return noteContent.slice(startIndex, endIndex);
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
      const dateFormat = this._dateFormat || (app && app.settings[this.constants.settingDateFormat]) || "en-US";
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

  /******************************************************************************************
   * All content replacing is routed through this function so that we can swap between interfacing with the note
   * directly, and using local strings for faster replace operations (no image flashing)
   * */
  async _replaceContent(note, sectionHeadingText, newContent, { level = 1 } = {}) {
    const replaceTarget = this._sectionFromHeadingText(sectionHeadingText, { level });
    if (this._useLocalNoteContents) {
      let throughLevel = replaceTarget.section.heading?.level;
      if (!throughLevel) throughLevel = sectionHeadingText.match(/^#*/)[0].length;
      if (!throughLevel) throughLevel = 1;

      const bodyContent = this._noteContents[note.uuid];
      const { startIndex, endIndex } = this._sectionRange(bodyContent, sectionHeadingText);

      if (startIndex) {
        const revisedContent = `${ bodyContent.slice(0, startIndex) }${ newContent.trim() }\n${ bodyContent.slice(endIndex) }`;
        this._noteContents[note.uuid] = revisedContent;
      } else {
        throw new Error(`Could not find section ${ sectionHeadingText } in note ${ note.name }`);
      }
    } else {
      await note.replaceContent(newContent, replaceTarget);
    }
  },

  /*******************************************************************************************/
  _sectionRange(bodyContent, sectionHeadingText) {
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

  /*******************************************************************************************/
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

  /*******************************************************************************************/
  async _sections(note, { minIndent = null } = {}) {
    let sections;
    if (this._useLocalNoteContents) {
      const content = this._noteContents[note.uuid];
      const headingMatches = content.matchAll(/^#+\s*([^\n]+)/gm);
      sections = Array.from(headingMatches).map(match => ({
        heading: {
          anchor: match[1].replace(/\s/g, "_"),
          level: /^#+/.exec(match[0]).length,
          text: match[1],
        }
      }));
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

  /*******************************************************************************************/
  async _noteContent(note) {
    if (this._useLocalNoteContents) {
      if (typeof this._noteContents[note.uuid] === "undefined") {
        this._noteContents[note.uuid] = await note.content();
      }
      return this._noteContents[note.uuid];
    } else {
      return await note.content();
    }
  },

  /*******************************************************************************************/
  async _flushLocalNotes(app) {
    for (const [uuid, content] of Object.entries(this._noteContents)) {
      const note = app.notes.find(uuid);
      await note.replaceContent(content);
      delete this._noteContents[uuid];
    }
  },

  /*******************************************************************************************
   * Don't let stray pipes fool table into getting cells wrong
   */
  _escapeCellContent(content) {
    return content.replace(/\|/g, ",");
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
    const parseableString = dateString.toLowerCase().replace(/\s?[ap]m/, "").replace(" at ", " ");
    const parsedDate = Date.parse(parseableString);
    if (parsedDate) {
      return new Date(parsedDate);
    } else {
      return null;
    }
  },

  /*******************************************************************************************
   * `book` can be either a highlights LIST from a book, or a book returned by BOOKS list
   */
  _bookNotePrefaceContentFromReadwiseBook(app, book, bookNoteUUID) {
    let sourceContent = book.source_url ? `[${ book.source }](${ book.source_url })` : book.source;
    let asinContent = "";
    if (book.asin) {
      if (!book.source.toLowerCase()) console.error("Book ", book.title, "does not have a source?")
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
   * Incorporate bookRowContent into a section in a dashboardNote
   */
  async _ensureBookInDashboardNoteTable(app, dashboardNote, bookRowContent) {
    const bookHighlightAt = (new RegExp(`^(?:\\|[^|]+){${ this._columnsBeforeUpdateDate }}\\|([^|]+)`)).exec(bookRowContent)[1];
    const bookTitle = (new RegExp(`^(?:\\|[^|]+){${ this._columnsBeforeTitle }}\\|([^|]+)`)).exec(bookRowContent)[1];
    const bookId = /bookreview\/([\d]+)/.exec(bookRowContent)[1];

    const dashboardContent = await this._noteContent(dashboardNote);
    let dashboardBookListMarkdown = this._sectionContent(dashboardContent, this.constants.dashboardBookListTitle);
    const sectionLabel = this._sectionLabelFromLastHighlight(bookHighlightAt);
    const sectionInNote = dashboardBookListMarkdown.includes(sectionLabel);

    // Already inserted this book into our dashboard ToC? Remove it so it can be refreshed. / precedes readwiseBook
    // based on the June 2023 expectation that we will link to readwise book ID
    const paredMarkdown = dashboardBookListMarkdown.replace(this._replaceRowRegexFromReadwiseBook(bookId), ""); // Remove the row from the book list content
    await this._replaceContent(dashboardNote, this.constants.dashboardBookListTitle, paredMarkdown);

    let content, sectionName;
    if (sectionInNote) {
      ({ content, sectionName } = this._insertRowIntoExistingSection(sectionLabel, paredMarkdown, bookRowContent,
        { bookTitle, bookHighlightAt }));
    } else { // No existing content for a sectionLabelText section, need to figure out where in the list of tables to place this one
      const minIndent = sectionLabel.match(/^#+/)[0]?.length;
      const eligibleSections = await this._sections(dashboardNote, { minIndent });
      ({ content, sectionName } = this._insertRowIntoNewSection(sectionLabel, paredMarkdown, bookRowContent, eligibleSections));
    }
    const level = sectionName === this.constants.dashboardBookListTitle ? 1 : 2; // 2 is the depth of the sections that are added within the level 1 this.constants.dashboardBookListTitle
    await this._replaceContent(dashboardNote, sectionName, content, { level });
  },

  /******************************************************************************************/
  _replaceRowRegexFromReadwiseBook(readwiseBookID) {
    return new RegExp(`^\.+\/${ readwiseBookID }[^\n]+\n`, "gm");
  },

  /******************************************************************************************
   * Return an object with { section: sectionReplaceToken, content: sectionContent }
   * */
  _insertRowIntoNewSection(sectionLabel, sectionTableContent, bookRowContent, eligibleSections) {
    const sectionLabelText = sectionLabel.replace(/^[#\s]+/, "");

    eligibleSections = eligibleSections.filter(s => !s.heading.text.includes(this.constants.unsortedSectionTitle));

    let sectionBeforeLabel = null;
    for (let i = 0; i < eligibleSections.length; i++) {
      const compareSection = eligibleSections[i].heading?.text || "";
      // Is this compareSection later than sectionLabelText? If so, it's a candidate to be the section before
      if (compareSection.localeCompare(sectionLabelText) > 0) {
        sectionBeforeLabel = compareSection;
      } else {
        break;
      }
    }

    // As of May 2023 AN markdown table exports have unusable junk rows that preface them, this replaces those junk
    // rows with our desired preamble rows
    const sectionContentWithoutTable = sectionTableContent.replace(/^\s*\|\s*Cover[^\n]+\n[|\-\s]+[\n\r]+/gm, this._tablePreambleContent());
    let bookListContent;
    if (sectionBeforeLabel) { // There is a section before this section
      const sectionBeforeContent = this._sectionContent(sectionContentWithoutTable, sectionBeforeLabel);
      bookListContent = sectionContentWithoutTable.replace(sectionBeforeContent,
        `${ sectionBeforeContent }\n${ sectionLabel }\n${ this._tablePreambleContent() }${ bookRowContent }\n`);
      // console.log("Inserting new section after label", sectionBeforeLabel," amidst existing", bookRowContent);
    } else { // No section before this one, put this first
      // console.log("Inserting new table ahead of", sectionTableContent);
      bookListContent = `${ sectionLabel }\n${ this._tablePreambleContent() }${ bookRowContent }\n${ sectionContentWithoutTable }`;
    }

    return { sectionName: this.constants.dashboardBookListTitle, content: bookListContent };
  },

  /******************************************************************************************
   * `sectionLabel` The label of the section to insert into, with or without preceding #s
   * `noteContent` Content from the note that contains a section for sectionLabel
   *
   * Returns a { section: sectionReplaceToken, content: sectionContent } object
   */
  _insertRowIntoExistingSection(sectionLabel, noteContent, bookRowContent,
      { bookTitle = null, bookHighlightAt = null, readwiseBook = null } = {}) {
    let rowMatch, precedingRow;
    bookTitle = bookTitle || readwiseBook?.title;
    bookHighlightAt = bookHighlightAt || readwiseBook?.last_highlight_at;
    const sortBy = bookHighlightAt ? "highlight" : "title";
    const insertBookDate = this._dateObjectFromDateString(bookHighlightAt);
    const labelLineRegex = new RegExp(`^[#\\s]*${ sectionLabel }[\\r\\n]+`, "m");
    const sectionMatch = noteContent.match(labelLineRegex);
    let contentEnded = false;

    // `tableBody` derived to allow analyzing only connected rows after the section label
    const tableBody = noteContent.substring(sectionMatch.index + sectionMatch[0].length).split("\n").filter(line => {
      if (contentEnded) {
        return false;
      } else if (line.match(/^\s*$/) || (line.match(/^\s*#+/) && !line.match(labelLineRegex))) {
        contentEnded = true;
        return false;
      } else {
        return true;
      }
    }).join("\n");

    // Find the row immediately before the row we want to insert to use as a replace target
    let rowIter = 0;
    const rowMatches = tableBody.matchAll(/\|\s*!\[[^\n]+(?:\n|$)/mg);
    if (rowMatches) {
      for (rowMatch of rowMatches) {
        rowIter += 1;
        const rowContent = rowMatch[0];

        if (rowIter > 10000) {
          alert("Error: Too many row iterations");
          break;
        }

        if (sortBy === "highlight") {
          const dateMatch = this._updateStampRegex().exec(rowContent);
          if (!dateMatch) debugger;
          const iterRowDate = this._dateObjectFromDateString(dateMatch[1])
          if (!iterRowDate || isNaN(iterRowDate.getTime())) {
            console.error("Failed to ascertain a date from", dateMatch[1])
          } else if (iterRowDate > insertBookDate) { // Older dates precede non-old rows
            precedingRow = rowContent;
          } else {
            break;
          }
        } else {
          const titleRegex = new RegExp(`^(?:\\|[^|]*){${ this._columnsBeforeTitle }}\\|\\s*([^|]+)\\s*\\|.*[\\r\\n]+`);
          const rowTitle = titleRegex.exec(rowContent)?.at(1);
          if (rowTitle.localeCompare(bookTitle) > 1) { // > 1 because we want the highest numbered date to be first in sorted list
            precedingRow = rowContent;
          } else {
            break;
          }
        }
      }
    }

    const sectionName = sectionLabel.replace(/^[#\s]+/, "");
    if (precedingRow) {
      const content = tableBody.replace(precedingRow.trim(), `${ precedingRow.trim() }\n${ bookRowContent }`);
      return { content, sectionName };
    } else {
      const trimmedTableBody = this._tableStrippedPreambleFromTable(tableBody).trim();
      const content = `${ this._tablePreambleContent() }${ bookRowContent }${ trimmedTableBody ? `${ trimmedTableBody }\n` : "" }`;
      return { content, sectionName };
    }
  },

  /*******************************************************************************************/
  _tableStrippedPreambleFromTable(tableContent) {
    [
      /^([|\s*]+(Cover|Book Title|Author|Category|Source|Highlights|Updated|Other Details)){1,10}[|\s*]*(?:[\r\n]+|$)/gm,
      /^[|\-\s]+(?:[\r\n]+|$)/gm, // Remove top two rows that markdown tables export as of June 2023
    ].forEach(removeString => {
      tableContent = tableContent.replace(removeString, "").trim();
    });

    tableContent = tableContent.replace(/^#+.*/g, ""); // Remove section label if present

    return tableContent;
  },

  /*******************************************************************************************/
  _tablePreambleContent() {
    return `| **Cover** | **Book Title** | **Author** | **Category** | **Source** | **Highlights** | **Updated** | **Other Details** | \n` +
      `|-|-|-|-|-|-|-|-|\n`;
  },

  /********************************************************************************************/
  _sectionLabelFromLastHighlight(lastHighlightDateString) {
    let sectionLabel;

    if (lastHighlightDateString) {
      const year = this._dateObjectFromDateString(lastHighlightDateString).getFullYear();
      sectionLabel = `## ${ year } Highlights`
    } else {
      sectionLabel = "## No highlights yet";
    }

    return sectionLabel;
  },

  /*******************************************************************************************/
  _bookRowContentFromReadwiseBook(app, readwiseBook, bookNoteUUID) {
    let sourceContent = readwiseBook.source;
    if (sourceContent === "kindle" && readwiseBook.asin) {
      sourceContent = `[${ readwiseBook.source }](kindle://book?action=open&asin=${ readwiseBook.asin })`;
    } else if (readwiseBook.source_url) {
      sourceContent = `[${ readwiseBook.source }](${ readwiseBook.source_url })`;
    }

    return `| ${ readwiseBook.cover_image_url ? `![Book cover](${ readwiseBook.cover_image_url })` : "[No cover image]" } ` +
    `| [${ this._escapeCellContent(readwiseBook.title) }](https://www.amplenote.com/notes/${ bookNoteUUID }) ` +
    `| ${ this._escapeCellContent(readwiseBook.author) } ` +
    `| ${ this._escapeCellContent(readwiseBook.category) } ` +
    `| ${ this._escapeCellContent(sourceContent) } ` +
    `| [${ readwiseBook.num_highlights } highlight${ readwiseBook.num_highlights === 1 ? "" : "s" }](https://www.amplenote.com/notes/${ bookNoteUUID }#Highlights}) ` +
    `| ${ readwiseBook.last_highlight_at ? this._localeDateFromIsoDate(app, readwiseBook.last_highlight_at) : "No highlights" } ` +
    `| [Readwise link](https://readwise.io/bookreview/${ readwiseBook.id }) | \n`; // `/bookreview/[\d]+` is used as a regex to grab Readwise book ID from row
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
      if (!highlight) continue;
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

    let highlightsContent = "";
    if (newHighlightsList.length) {
      // Highlight IDs were added June 2023, after initial launch. If the plugin content doesn't show existing signs of
      // highlight IDs, we'll replace all highlight content to avoid dupes
      if (/\(#H[\d]+\)/.test(existingHighlightsContent)) {
        highlightsContent = newHighlightsList.join("\n") + "\n" + existingHighlightsContent + "\n\n";
      } else {
        highlightsContent = newHighlightsList.join("\n") + "\n\n";
      }
    } else {
      highlightsContent = existingHighlightsContent;
    }
    return highlightsContent;
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
      if (dateString.includes("pm")) {
        const hourMatch = dateString.match(/at\s([\d]{1,2}):/);
        if (hourMatch) {
          dateString = dateString.replace(` ${ hourMatch[1] }:`, ` ${ parseInt(hourMatch[1]) + 12 }:`);
        } else {
          console.error("Error parsing dateString");
        }
      }
      const result = this._dateObjectFromDateString(dateString)
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

  /*******************************************************************************************
   * Returns the `book` json object from Readwise. Currently contains keys for [id, title, author, category, source,
   * cover_image_url], and other stuff enumerated at https://readwise.io/api_deets under "Books LIST"
   */
  async* _readwiseFetchBooks(app, dashboardNote, direction) {
    const url = new URL(`${ this.constants.readwiseBookIndexURL }/`);

    const dashboardContent = await this._noteContent(dashboardNote);
    if (dashboardContent) {
      let params;
      if (direction === "forward") {
        const updateThrough = dashboardContent.match(new RegExp(`${ this.constants.lastUpdatedContentLabel }(.*)`));
        if (updateThrough) {
          params = new URLSearchParams();
          let updatedGtValue = new Date(Date.parse(updateThrough[1]));
          updatedGtValue = updatedGtValue.toISOString().slice(0, -1) + 'Z';
          console.log("Found updateThrough match", updateThrough, "submitting as", updatedGtValue);
          params.append('updated__gt', updatedGtValue);
        }
      } else { // Direction backward
        const earliestAt = dashboardContent.match(new RegExp(`${ this.constants.firstUpdatedContentLabel }(.*)`));
        if (earliestAt) {
          params = new URLSearchParams();
          let updatedLtValue = new Date(Date.parse(earliestAt[1]));
          updatedLtValue = updatedLtValue.toISOString().slice(0, -1) + 'Z';
          console.log("Found updateUntil match", earliestAt, "submitting as", updatedLtValue);
          params.append('updated__lt', updatedLtValue);
        } else {
          return []; // If we don't have an earliestAt, we can't traverse toward earliest
        }
      }
      if (params) url.search = params;
    }

    yield* this._readwisePaginateRequest(app, url);
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
        console.error("Null result trying fetch. Sleeping before final retry")
        await new Promise(resolve => setTimeout(resolve,this.constants.sleepSecondsAfterRequestFail * 1000));
        return await tryFetch();
      }
    } catch (e) {
      console.trace();
      console.error("Handling", e, "stack", e.stack);
      debugger;
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

  /*******************************************************************************************
   * Print the count of books reported by Readwise atop the Dashboard note
   */
  async _prependReadwiseBookCountContent(app, dashboardNote) {
    const bookIndexResponse = await this._readwiseMakeRequest(app, `${ this.constants.readwiseBookIndexURL }?page_size=1`)
    if (bookIndexResponse?.count) {
      const dashboardNoteContent = await this._noteContent(dashboardNote);
      if (!dashboardNoteContent.includes(this.constants.dashboardLibraryDetailsHeading)) {
        await this._insertContent(dashboardNote, "# " + this.constants.dashboardLibraryDetailsHeading + "\n");
      }
      let bookIndexContent = `- Book count reported by Readwise: ${ bookIndexResponse.count }\n`;
      await this._replaceContent(dashboardNote, this.constants.dashboardLibraryDetailsHeading, bookIndexContent);
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

    const lastUpdatedAt = this._boundaryBookUpdatedAtFromNoteContent(dashboardNoteContent, true);
    const earliestUpdatedAt = this._boundaryBookUpdatedAtFromNoteContent(dashboardNoteContent, false);
    const existingDetailContent = this._sectionContent(dashboardNoteContent, this.constants.dashboardLibraryDetailsHeading) || "";
    let detailContent = `- Last synced at: ${ this._localeDateFromIsoDate(app, new Date()) }\n`;
    detailContent += `- ${ this.constants.firstUpdatedContentLabel }${ this._localeDateFromIsoDate(app, earliestUpdatedAt) }\n`;
    detailContent += `- ${ this.constants.lastUpdatedContentLabel }${ this._localeDateFromIsoDate(app, lastUpdatedAt) }\n`;
    const tableRowCount = dashboardNoteContent.match(/^\|!\[]/gm)?.length || 0;
    detailContent += `- ${ this.constants.booksImportedLabel }: ${ tableRowCount }\n`;
    const readwiseCountMatch = existingDetailContent.match(/Book count reported by Readwise: ([\d]+)/m);
    const readwiseCount = bookCount ? bookCount : (readwiseCountMatch ? parseInt(readwiseCountMatch[1]) : null);
    if (Number.isInteger(readwiseCount)) detailContent += `- Book count reported by Readwise: ${ readwiseCount }\n`;

    await this._replaceContent(dashboardNote, this.constants.dashboardLibraryDetailsHeading, detailContent);
  },

  /*******************************************************************************************
   * Keep details about imported books updated
   * `findLatest` if true, we will return the latest datestamp, if false we will find the earliest
   */
  _boundaryBookUpdatedAtFromNoteContent(noteContent, findLatest) {
    // Derive the latest "updated at" time from existing table rows
    let boundaryUpdatedAt, dateMatch;
    const updateColumnRegex = this._updateStampRegex();
    while (dateMatch = updateColumnRegex.exec(noteContent)) {
      const dateObject = this._dateObjectFromDateString(dateMatch[1])
      if (!dateObject || isNaN(dateObject.getTime())) {
        // No usable dateObject from this row
      } else if (!boundaryUpdatedAt || (findLatest && dateObject > boundaryUpdatedAt) || (!findLatest && dateObject < boundaryUpdatedAt)) {
        boundaryUpdatedAt = dateObject;
      }
    }
    console.log("Found lastUpdatedAt", boundaryUpdatedAt, "aka", this._localeDateFromIsoDate(boundaryUpdatedAt), "the", (findLatest ? "latest" : "earliest"), "record");

    return boundaryUpdatedAt;
  },

  /*******************************************************************************************/
  async _migrateBooksToSections(app, dashboardNote) {
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
        dashboardBookListMarkdown = this._sectionContent(await this._noteContent(dashboardNote), this.constants.dashboardBookListTitle);
        console.log("Your Readwise library will be updated to split highlights into sections for faster future updates. This might take a few minutes if you have a large library.");
      }

      for (const bookMatch of bookListRows) {
        const bookRowContent = bookMatch[0];
        await this._ensureBookInDashboardNoteTable(app, dashboardNote, bookRowContent);
      }

      // Remove the old book list section
      const unsortedContent = this._sectionContent(await this._noteContent(dashboardNote), this.constants.unsortedSectionTitle);
      const unsortedWithoutTable = this._tableStrippedPreambleFromTable(unsortedContent);
      if (unsortedContent.length && (unsortedWithoutTable?.trim()?.length || 0) === 0) {
        await this._replaceContent(dashboardNote, this.constants.unsortedSectionTitle, "");
        dashboardBookListMarkdown = this._sectionContent(await this._noteContent(dashboardNote), this.constants.dashboardBookListTitle);
        dashboardBookListMarkdown = dashboardBookListMarkdown.replace(new RegExp(`#+\\s${ this.constants.unsortedSectionTitle }[\\r\\n]*`), "")
        await this._replaceContent(dashboardNote, this.constants.dashboardBookListTitle, dashboardBookListMarkdown.trim());
        console.log("Successfully migrated books to yearly sections");
      }

      await this._flushLocalNotes(app);
    };

    this._useLocalNoteContents = true;
    await doMigrate();
    this._useLocalNoteContents = false;
  },

  /*******************************************************************************************/
  _initialize() {
    this._abortExecution = false;
    this._columnsBeforeUpdateDate = 6;
    this._columnsBeforeTitle = 1;
    this._dateFormat = null;
    this._forceReprocess = false;
    this._lastRequestTime = null;
    this._noteContents = {};
    this._requestsCount = 0;
    // When doing mass updates, it's preferable to work with the string locally and replace the actual note content
    // less often, since each note content replace triggers a redraw of the note table & all its per-row images.
    // When this is enabled (globally, or for a particular method), the locally-manipulated note contents must be
    // flushed to the actual note content via this._flushLocalNotes(app) before the method returns.
    this._useLocalNoteContents = false;
    if (this._testEnvironment === undefined) this._testEnvironment = false;
  }
}
export default plugin;
