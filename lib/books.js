import { _getLastUpdatedTimeFromNote } from './books.js';
import { _noteContent,
  _insertContent,
  _replaceContent,
  _sectionContent,
  _textToTagName
} from './amplenote_rw.js';
import { _readwiseFetchBooks } from './readwise.js';
import { _sectionsFromMarkdown,
  _markdownFromSections,
  _markdownFromHighlights,
} from './markdown.js';
import { _groupByValue,
  _distributeIntoSmallGroups
} from './data_structures.js';
import { _yearFromDateString,
  _localeDateFromIsoDate
} from './dates.js';
/*******************************************************************************************/
/* Book notes
/*******************************************************************************************/

/*******************************************************************************************
 * Sync highlights for a book into the note provided. This method does all of the propagation from
 * Readwise Highlight object to list of highlights in a note
 *
 * Returns true if successful
 */
export async function _syncBookHighlights(app, bookNote, readwiseBookID, { readwiseBook = null, throwOnFail = false } = {}) {
  console.log(`_syncBookHighlights(app, ${bookNote}, ${readwiseBookID})`);
  let lastUpdatedAt = await _getLastUpdatedTimeFromNote(app, bookNote);
  if (this._forceReprocess) {
    lastUpdatedAt = null;
  }

  // Import all (new) highlights from the book
  const noteContent = await _noteContent(bookNote) || "";

  if (!noteContent.includes("# Summary")) {
    await _insertContent(bookNote,"# Summary\n");
  }

  if (!readwiseBook) {
    let generator = _readwiseFetchBooks(app, {bookIdFilter: readwiseBookID});
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

  const summaryContent = _bookNotePrefaceContentFromReadwiseBook(app, readwiseBook, bookNote.uuid);
  await _replaceContent(bookNote, "Summary", summaryContent);

  let highlightsContent = "";
  if (!noteContent.includes("# Highlights")) {
    await _insertContent(bookNote, "\n# Highlights\n", { atEnd: true });
  } else {
    highlightsContent = _sectionContent(noteContent, "Highlights");
  }
  let highlights = await _sectionsFromMarkdown(bookNote, "Highlights", this._loadHighlights);

  let bookNoteHighlightList = await _bookHighlightsContentFromReadwiseBook(app, readwiseBook, highlights, lastUpdatedAt);
  const sortOrder = app.settings[this.constants.settingSortOrderName] || this.constants.defaultHighlightSort;
  let hlGroups = _groupByValue(bookNoteHighlightList,
    item => {
      if (!item.highlighted_at) return "No higlight date";
      let year = _yearFromDateString(item.highlighted_at);
      if (!year) return "No highlight date";
      return year;
    },
  );
  hlGroups = _distributeIntoSmallGroups(app, hlGroups, this.constants.maxBookHighlightsPerSection, this._trimHighlights.bind(this));
  let entries = Object.entries(hlGroups);
  entries.sort((a, b) => b[0].localeCompare(a[0]));
  let hlMarkdown = _markdownFromSections(app, entries, _markdownFromHighlights.bind(this));

  try {
    await _replaceContent(bookNote, "Highlights", hlMarkdown);
  } catch (error) {
    console.log("Error replacing", readwiseBook.title, "content, length", hlMarkdown.length ," error", error);
  }

  let existingContent = "";
  if (!noteContent.includes("Sync History")) {
    await _insertContent(bookNote, "\n# Sync History\n", { atEnd: true });
  } else {
    const match = noteContent.match(/#\sSync\sHistory\n([\s\S]+)$/m);
    existingContent = match ? match[1] : "";
  }

  await _replaceContent(bookNote, "Sync History",`${ this.constants.updateStringPreface }${ _localeDateFromIsoDate(app, new Date()) }\n` + existingContent);
  return true;
}

/*******************************************************************************************
 * Returns the note handle of a highlight note given a Readwise Book object
 * Will return an existing note if a note title is matched, or will create a new one otherwise.
 * Will add a new link to the Readwise Dashboard if the note is created.
 *
 * Params
 * readwiseBook: a Readwise Book object (see "Books LIST" on https://readwise.io/api_deets or https://public.amplenote.com/9rj3D65n8nrQPGioxUgrzYVo)
 */
export async function _ensureBookNote(app, readwiseBook) {
  const baseTag = app.settings[this.constants.settingTagName] || this.constants.defaultBaseTag;
  console.debug(`_ensureBookNote(${ readwiseBook.title })`, baseTag);

  // First, check if the note for this book exists
  const readwiseNotes = await app.filterNotes({ tag: baseTag });
  const bookRegex = new RegExp(`ID\\s?#${ readwiseBook.id }`);
  const searchResults = readwiseNotes.filter(item => bookRegex.test(item.name));
  let bookNote = null;
  if (searchResults.length === 0) {
    const noteTitle = _noteTitleFromBook(readwiseBook);

    // Create the note if it doesn't exist
    const bookNoteTags = [`${ baseTag }/${ _textToTagName(readwiseBook.category) }`];
    if (app.settings[this.constants.settingAuthorTag] === "true") {
      const candidateAuthorTag = _textToTagName(readwiseBook.author);
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
}

/*******************************************************************************************
 * Returns the title of the note in Amplenote, given a book object
 */
export function _noteTitleFromBook(book) {
  return `${ book.title } by ${ book.author } Highlights (ID #${ book.id })`;
}

/*******************************************************************************************
 * `book` can be either a highlights LIST from a book, or a book returned by BOOKS list
 */
export function _bookNotePrefaceContentFromReadwiseBook(app, book, bookNoteUUID) {
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
    `- Book Author: [${ book.author }](/notes/${ bookNoteUUID }?tag=${ baseTag }/${ _textToTagName(book.author) })\n` +
    `- Category: ${ book.category }\n` +
    `- Source: ${ sourceContent }\n` +
    (asinContent ? `- ${ asinContent }\n` : "") +
    `- Highlight count: ${ book.num_highlights }\n` +
    `- Last highlight: ${ _localeDateFromIsoDate(app, book.last_highlight_at) }\n` +
    `- [View all highlights on Readwise](https://readwise.io/bookreview/${ book.id })\n` +
    `\n\n`; // Since replace will get rid of all content up to the next heading
}

/*******************************************************************************************
 * Return a book object to be used in the Dashboard note from a readwiseBook object as returned by Readwise
 * Need to pass the bookNote Amplenote handle for that book in order to return a markdown link to that amplenote
 */
export function _bookObjectFromReadwiseBook(app, readwiseBook, bookNoteUUID) {
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
    "Updated": `${ readwiseBook.last_highlight_at ? _localeDateFromIsoDate(app, readwiseBook.last_highlight_at) : "No highlights" }`,
    // `/bookreview/[\d]+` is used as a regex to grab Readwise book ID from row
    "Other Details": `[Readwise link](https://readwise.io/bookreview/${ readwiseBook.id })`,
  };
}

/*******************************************************************************************
 * Return a list of highlight objects from markdown
 */
export function _loadHighlights(markdown) {
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
}

/*******************************************************************************************
 * Generate the string that should be inserted into the "Highlights" section of a note.
 * Will always return a non-null string
 */
export async function _bookHighlightsContentFromReadwiseBook(app, readwiseBook, existingHighlights, lastUpdatedAt) {
  console.log(`Getting all highlights for ${ readwiseBook.title }. Last updated at: ${ lastUpdatedAt }. Existing highlights length: ${ existingHighlights?.length }`);
  // const newHighlightsList = _getNewHighlightsForBook(app, readwiseBook);
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
}

