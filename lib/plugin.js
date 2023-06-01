import fetch from "isomorphic-fetch"

// --------------------------------------------------------------------------------------
// Latest AN docs https://www.amplenote.com/help/developing_amplenote_plugins
// Get Readwise API key from https://readwise.io/access_token
const plugin = {
  constants: {
    baseTag: "capture/readwise",
    maxBooksFetchedPerInvoke: 100,
    maxHighlightLimit: 5000,
    rateLimit: 20, // Configure the rate limit (in requests per minute)
    readwiseBookIndexURL: "https://readwise.io/api/v2/books",
    readwiseHighlightsIndexURL: "https://readwise.io/api/v2/highlights",
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
          this._syncBookHighlights(app, bookNote, book);
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
        const titleRegex = /ID:\s?#([\d]+)/;
        const match = noteTitle.match(titleRegex);
        if (!match) {
          throw new Error("The note title format is incorrect. It should contain an 'ID' designator, like 'ID: #123', in the title");
        }

        // Import all (new) highlights from the book
        const bookId = match[1];
        const readwiseBook = await this._readwiseFetchBook(app, bookId);
        this._syncBookHighlights(app, currentNote, readwiseBook);

        await app.alert("✅ Book highlights fetched successfully!")
      } catch (error) {
        await app.alert(String(error));
      }
    },
  },

  /*******************************************************************************************
   * Sync highlights for a book into the note provided
   */
  _syncBookHighlights: async function (app, bookNote, readwiseBook) {
    const lastUpdatedAt = await this._getLastUpdatedTimeFromNote(app, bookNote);

    // Import all (new) highlights from the book
    let hlCount = 0;
    for await (const highlight of this._readwiseGetAllHighlightsForBook(app, readwiseBook.id, lastUpdatedAt)) {
      if (hlCount > this.constants.maxHighlightLimit) {
        // Hard code an upper limit to the amount of books we process
        break;
      }
      await bookNote.insertContent(` - ${ highlight["text"] }`);
      hlCount++;
    }

    // Store the time stamp of the last sync as the top line in the note
    // Format: 2022-07-12T14:30:15.123Z
    const now = new Date().toISOString();
    await bookNote.insertContent(`# Last updated at: ${ now }`);
  },

  /*******************************************************************************************
   * Returns the title of the note in Amplenote, given a book object
   */
  _noteTitleFromBook(book) {
    return `${ book.title } by ${ book.author } highlights (ID #${ book.id })`;
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
    const tag = app.settings[`Tag to assign to Readwise notes (default: '${ this.constants.baseTag }')`] || this.constants.baseTag;

    // First, check if the note for this book exists
    const readwiseNotes = await app.filterNotes({ tag: tag });
    const bookRegex = new RegExp(`ID:\s?#${ readwiseBook.id }`);
    const searchResults = readwiseNotes.filter(item => bookRegex.test(item.name));
    let bookNote = null;
    if (searchResults.length === 0) {
      const noteTitle = this.noteTitleFromBook(readwiseBook);
      console.log(`Creating note with title ${ noteTitle }...`);
      // Create the note if it doesn't exist
      bookNote = await app.notes.create(noteTitle, [ tag ]);
      const dashboardNoteContents = await dashboardNote.content();
      if (dashboardNoteContents.indexOf("Book Title") === -1) {
        // Add a header to the dashboard note if it doesn't exist
        await dashboardNote.insertContent("# Readwise Book List Dashboard\n")
        await dashboardNote.insertContent("| *Cover* | *Book Title* | *Author* | *Category* | *Source* | *Highlight Date* | *Other Details* |\n");
      }
      // Create a table row in Dashboard note for details about the book
      const readwiseBookRow = `| ![Book cover](${ readwiseBook.cover_image_url }) ` +
        `| [${ readwiseBook.title }](https://www.amplenote.com/notes/${ bookNote.uuid }) ` +
        `| ${ readwiseBook.author } ` +
        `| ${ readwiseBook.category } ` +
        `| [${ readwiseBook.source }](${ readwiseBook.source_url }) `+
        `| ${ readwiseBook.last_highlight_at } ` +
        `|  |\n`;
      await dashboardNote.insertContent(readwiseBookRow);
    } else {
      const newNoteUUID = searchResults[0].uuid;
      bookNote = await app.notes.find(newNoteUUID);
      console.log(`Note exists: ${ readwiseBook.title }`, bookNote);
    }
    return bookNote;
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

    const firstLine = lines[0];
    const dateTimeString = firstLine.slice(19);
    const dateObj = new Date(dateTimeString);
    if (isNaN(dateObj.getTime())) {
      console.log("No date on first line.");
      return null;
    }
    console.log(`Date: $dateObj.getTime()`);
    return dateObj;
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
    // await app.alert(url + " " + updatedGt);
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
    console.log(`readwisePaginateRequest(${ app }, ${ baseUrl })`);
    let currentPage = 1;
    let hasNextPage = true;

    while (hasNextPage) {
      baseUrl.searchParams.append('page', currentPage);
      const data = await this._readwiseMakeRequest(app, baseUrl);
      for (const item of data.results) {
        console.log(item);
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

    const headers = new Headers({
      'Authorization': `Token ${ readwiseAPIKey }`,
      'Content-Type': 'application/json',
    });

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
};
export default plugin;
