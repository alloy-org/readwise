import {_localeDateFromIsoDate} from "../lib/dates.js";

export const tableHeaders = ["Cover", "Book Title", "Author", "Category", "Source", "Highlights", "Updated", "Other Details"];

export function createDashboard(
  lastSyncedAt,
  oldestUpdateSyncedIn,
  nextSync,
  booksInTable,
  booksInReadwise,
  booksByYear) {
  let result = [];
  result.push(`#Library Details`);
  result.push(`- Last synced at: ${lastSyncedAt}`);
  result.push(`- Oldest update synced in: ${oldestUpdateSyncedIn}`);
  result.push(`- Next sync for content updated after: ${nextSync}`);
  result.push(`- Readwise books imported into table: ${booksInTable}`);
  result.push(`- Book count reported by Readwise: ${booksInReadwise}`);

  result.push(`# Readwise Book List`);
  for (let obj of booksByYear) {
    let year = obj.year;
    result.push(`## ${year}`);
    result.push(`| ` + tableHeaders.map(cell => `**${cell}**`).join(` | `) + ` |`);
    result.push(`| --- | --- | --- | --- | --- | --- | --- | --- |`);

    for (let bookObj of obj.rows) {
      let key = bookObj.id;
      let book = bookObj.book;

      let bookRow = [];
      bookRow.push(`![\\|200](${book.cover_image_url})`);
      bookRow.push(`[${book.title}](https://www.amplenote.com/notes/${key})`);
      bookRow.push(`${book.author}`);
      bookRow.push(`${book.category}`);
      if (book.source === "kindle") {
        bookRow.push(`[${book.source}](kindle://book?action=open&asin=${book.asin})`);
      } else {
          bookRow.push(book.source);
      }
      bookRow.push(`[${book.num_highlights} highlight](https://www.amplenote.com/notes/${key}#Highlights)`);
      bookRow.push(`${_localeDateFromIsoDate(book.last_highlight_at)}`);
      bookRow.push(`[Readwise link](https://readwise.io/bookreview/${book.id})`);
      result.push(`| ` + bookRow.join(` | `) + ` |`);
    }
  }
  return result.join("\n");
}