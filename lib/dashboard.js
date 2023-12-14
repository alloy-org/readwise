import { _noteContent,
  _replaceContent,
  _sectionContent,
} from './amplenote_rw.js';
import { _markdownFromSections, 
  _markdownFromTable,
  _tableFromMarkdown,
  _tableStrippedPreambleFromTable
} from './markdown.js';
import { _distributeIntoSmallGroups } from './data_structures.js';
import { _localeDateFromIsoDate,
  _dateObjectFromDateString
} from './dates.js';
import { _flushLocalNotes, } from './amplenote_rw.js';

/*******************************************************************************************/
/* Dashboard manipulation
/*******************************************************************************************/

/*******************************************************************************************
 * Persists a dashboard ojbect into the dashboardNote note
 */
export async function _writeDashboard(app, noteContents, dashboard, dashboardNote, dashboardConstants) {
  console.debug(`_writeDashboard()`);
  // SORT each section
  for (let [key, value] of Object.entries(dashboard)) {
    dashboard[key] = value.sort(_sortBooks);
  }
  // SORT the order of sections
  dashboard = _distributeIntoSmallGroups(dashboard, dashboardConstants.maxTableBooksPerSection);
  let entries = Object.entries(dashboard);
  entries.sort((a, b) => b[0].localeCompare(a[0]));

  let dashboardMarkdown = _markdownFromSections(app, entries, _markdownFromTable.bind(this));
  await _replaceContent(noteContents, dashboardNote, dashboardConstants.dashboardBookListTitle, dashboardMarkdown);
}

/*******************************************************************************************
 * Insert a book object in the dashboard object
 */
export async function _ensureBookInDashboardNoteTable(app, dashboard, bookObject) {
  console.log(`_ensureBookInDashboardNoteTable(app, ${bookObject})`);

  for (let year of Object.keys(dashboard)) {
    let entries = dashboard[year];
    for (let e of entries) {
      console.debug(e["Book Title"]);
    }
  }
  _removeBookFromDashboard(dashboard, bookObject);
  let year = _sectionNameFromLastHighlight(bookObject.Updated);

  if (year in dashboard) {
    dashboard[year].push(bookObject);
    dashboard[year] = dashboard[year].sort(_sortBooks);
  } else {
    dashboard[year] = [bookObject];
  }
}

export function _sectionNameFromLastHighlight(lastHighlightDateString) {
  let year = "";
  if (lastHighlightDateString && _dateObjectFromDateString(lastHighlightDateString)) {
    year = _dateObjectFromDateString(lastHighlightDateString).getFullYear();
  } else {
    year = "(No highlights yet)";
  }
  return year;
}

/*******************************************************************************************
 * Removes a book represented by a book object from the dashboard object
 */
export function _removeBookFromDashboard(dashboard, bookObject) {
  for (let year of Object.keys(dashboard)) {
    const index = dashboard[year].findIndex(book => bookObject["Book Title"] === book["Book Title"]);
    if (index !== -1) {
      dashboard[year].splice(index, 1);
      break;
    }
  }
}


/*******************************************************************************************
 * Keep details about imported books updated
 */
export async function _updateDashboardDetails(app, dashboard, dashDetailsFieldNames, dateFormat, details, {tableRowCount = null, bookCount = null } = {}) {
  console.log(`_updateDashboardDetails(app, ${dashboard}, ${details}, ${tableRowCount}, ${bookCount} )`);

  const lastUpdatedAt = _boundaryBookUpdatedAtFromDashboard(dashboard, true);
  const earliestUpdatedAt = _boundaryBookUpdatedAtFromDashboard(dashboard, false);

  details[dashDetailsFieldNames.lastSyncedAt] = _localeDateFromIsoDate(new Date(), dateFormat);
  details[dashDetailsFieldNames.firstUpdated] = _localeDateFromIsoDate(earliestUpdatedAt, dateFormat);
  details[dashDetailsFieldNames.lastUpdated] = _localeDateFromIsoDate(lastUpdatedAt, dateFormat);
  details[dashDetailsFieldNames.booksImported] = tableRowCount;
  let booksReported = details[dashDetailsFieldNames.booksReported];
  details[dashDetailsFieldNames.booksReported] = bookCount ? bookCount : booksReported;
}

export function _boundaryBookUpdatedAtFromDashboard(dashboard, findLatest) {
  let result;
  for (let group in dashboard) {
    for (let item of dashboard[group]) {
      let itemDate = _dateObjectFromDateString(item.Updated);
      if (! itemDate || isNaN(itemDate.getTime())) {
        // No usable date object from this row
      } else if (!result || findLatest && itemDate > result || (!findLatest && itemDate < result)) {
        result = itemDate;
      }
    }
  }
  console.debug("Found lastUpdatedAt", result, "aka", _localeDateFromIsoDate(result, "en-us"), "the", (findLatest ? "latest" : "earliest"), "record");
  return result;
}

/*******************************************************************************************
 * Load the dashboard details from Markdown into an object
 */
export function _loadDetails(text) {
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
}

/*******************************************************************************************
 * Writes dashboard details from an object into markdown
 */
export function _writeDetails(details) {
  let text = '';

  for (let key of Object.keys(details)) {
    text += `- ${key}: ${details[key]}\n`;
  }
  return text;
}

/*******************************************************************************************
 * Migrates books to sections if found otherwise
 */
export async function _migrateBooksToSections(app, noteContents, dashboardNote, dashboardConstants) {
  console.log(`_migrateBooksToSections`);
  const doMigrate = async () => {
    const dashboardNoteContent = await _noteContent(noteContents, dashboardNote);
    let dashboardBookListMarkdown = _sectionContent(dashboardNoteContent, dashboardConstants.dashboardBookListTitle);
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
    if (subSections.length && !subSections.find(heading => heading === dashboardConstants.unsortedSectionTitle)) {
      console.log("Book list is already in sections, no migration necessary");
      return;
    } else if (!dashboardBookListMarkdown.includes(dashboardConstants.unsortedSectionTitle)) {
      const unsortedSectionContent = `## ${ dashboardConstants.unsortedSectionTitle }\n${ dashboardBookListMarkdown }`;
      await _replaceContent(noteContents, dashboardNote, dashboardConstants.dashboardBookListTitle, unsortedSectionContent);
      // dashboardBookListMarkdown = _sectionContent(await _noteContent(dashboardNote), constants.dashboardBookListTitle);
      console.log("Your Readwise library will be updated to split highlights into sections for faster future updates. This might take a few minutes if you have a large library.");
    }

    const dashboard = {};
    const bookObjectList = _tableFromMarkdown(dashboardBookListMarkdown);
    const processed = [];
    for (const bookObject of bookObjectList) {
      console.debug("Processing", processed.length, "of", bookObjectList.length, "books");
      await _ensureBookInDashboardNoteTable(app, dashboard, bookObject);
    }
    await _writeDashboard(app, noteContents, dashboard, dashboardNote, dashboardConstants);

    // Remove the old book list section
    const unsortedContent = _sectionContent(await _noteContent(noteContents, dashboardNote), dashboardConstants.unsortedSectionTitle);
    const unsortedWithoutTable = _tableStrippedPreambleFromTable(unsortedContent);
    if (unsortedContent.length && (unsortedWithoutTable?.trim()?.length || 0) === 0) {
      await _replaceContent(noteContents, dashboardNote, dashboardConstants.unsortedSectionTitle, "");
      dashboardBookListMarkdown = _sectionContent(await _noteContent(noteContents, dashboardNote), dashboardConstants.dashboardBookListTitle);
      try {
        dashboardBookListMarkdown = dashboardBookListMarkdown.replace(new RegExp(`#+\\s${ dashboardConstants.unsortedSectionTitle }[\\r\\n]*`), "");
      } catch (err) {
        if (err.name === "TypeError") {
          throw(new Error(`${ err.message} (line 486)`));
        }
      }
      await _replaceContent(noteContents, dashboardNote, dashboardConstants.dashboardBookListTitle, dashboardBookListMarkdown.trim());
      console.log("Successfully migrated books to yearly sections");
    }

    await _flushLocalNotes(app, noteContents);
  };

  await doMigrate();
}

/*******************************************************************************************
 * Define sort order for books inside the Dashboard tables
 */
export function _sortBooks(a, b) {
  // Sort highlights with missing date fields at the bottom
  if (!a.Updated) {
    if (a["Book Title"] < b["Book Title"]) return -1;
    else return 1;
  } else {
    return new Date(b.Updated) - new Date(a.Updated);
  }
}
