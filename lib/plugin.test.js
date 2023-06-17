import { jest } from "@jest/globals"
import { mockApp, mockPlugin, mockNote } from "./test-helpers.js"

import plugin from "./plugin.js"

export const readwiseBook1 = {
  "id": 17506326,
  "title": "It's All Too Much",
  "author": "Peter Walsh",
  "category": "books",
  "source": "kindle",
  "num_highlights": 1,
  "last_highlight_at": "2012-03-29T04:56:00Z",
  "updated": "2022-08-05T18:25:10.818174Z",
  "cover_image_url": "https://images-na.ssl-images-amazon.com/images/I/51y7BxD2f5L._SL200_.jpg",
  "highlights_url": "https://readwise.io/bookreview/17506326",
  "source_url": null,
  "asin": "B000N2HCP6",
  "tags": [],
  "document_note": ""
};

// --------------------------------------------------------------------------------------
// Note that some of these tests actually make calls to OpenAI. Normally tests would be mocked for
// a remote call, but for Bill's current purposes, it's pretty useful to be able to see what the real
// API responds with as I iterate upon new possible methods
describe("plugin", () => {
  const plugin = mockPlugin();

  // --------------------------------------------------------------------------------------
  describe("with a mocked app", () => {
    const bookNoteUUID = 123;
    const fauxRow = `![book cover](https://www.gitclear.com/image.jpg) | William Harding | books | [kindle](https://kindle.com/blah) | [5 highlights](https://amplenote.com/notes/abc333) | January 1, 2005 | [Readwise link](999)`;
    const readwiseRow = plugin._bookRowContentFromReadwiseBook(null, readwiseBook1, bookNoteUUID);
    const content = `# Library Details
      - Last synced at: June 15, 2023 3:39 PM
      - Oldest update synced in: August 5, 2022
      - Next sync for content updated after: August 5, 2022
      - Readwise books imported into table: 18
      - Book count reported by Readwise: 25
      
      # ${ plugin.constants.dashboardBookListTitle }\n${ plugin._tablePreambleContent() }\n| ${ fauxRow } |\n| ${ readwiseRow } |`.replace(/\n\s*/g, "\n");
    const dashboardNote = mockNote(content, plugin.constants.defaultDashboardNoteTitle, 123);
    const app = mockApp(dashboardNote);

    async function* getBook() { yield ({ ...readwiseBook1 }) }
    plugin._readwiseMakeRequest = jest.fn().mockResolvedValue({ count: 0 });
    plugin._readwiseFetchBooks = getBook.bind(plugin);
    plugin._testEnvironment = true;
    plugin._ensureBookNote = jest.fn().mockResolvedValue({ ...dashboardNote });

    it("should migrate from generic container to specific", async () => {
      plugin._initialize();
      await plugin._migrateBooksToSections(app, dashboardNote)
      expect(dashboardNote.body).toEqual(`# Library Details
        - Last synced at: June 15, 2023 3:39 PM
        - Oldest update synced in: August 5, 2022
        - Next sync for content updated after: August 5, 2022
        - Readwise books imported into table: 18
        - Book count reported by Readwise: 25
        
        # ${ plugin.constants.dashboardBookListTitle }
        ${ this._sectionLabelFromLastHighlight("January 5, 2005") }
        ${ plugin._tablePreambleContent() }
        | ${ fauxRow } |
        
        ${ this._sectionLabelFromLastHighlight(readwiseBook1.last_highlight_at) }
        ${ plugin._tablePreambleContent() }
        | ${ readwiseRow } |`.replace(/\n\s*/g, "\n"));
    });

    it("should sync all books", async () => {
      const result = await plugin.noteOption["Sync all"](app, dashboardNote.uuid);
      expect(dashboardNote.body).toEqual("Something");
    });
  });
});
