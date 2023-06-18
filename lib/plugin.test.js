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
  plugin._testEnvironment = true;
  const bookNoteUUID = 123;
  const dashboardNoteUUID = 456789;

  const fauxRowEarlier = `![book cover](https://www.gitclear.com/image.jpg) | [The Earliest Book][https://amplenote.com/notes/123321] | William Harding | books | [kindle](https://kindle.com/blah) | [5 highlights](https://amplenote.com/notes/abc333) | January 1, 2005 | [Readwise link](https://gitclear.com/bookreview/999)`;
  const fauxRowLater = `![book cover](https://www.gitclear.com/image.jpg) | [The Latest Book][https://amplenote.com/notes/123322] | William Harding | books | [kindle](https://kindle.com/blah) | [5 highlights](https://amplenote.com/notes/abc333) | February 22, 2005 | [Readwise link](https://gitclear.com/bookreview/1005)`;
  const fauxRowMiddle = `![book cover](https://www.gitclear.com/image.jpg) | [The Middle Book][https://amplenote.com/notes/123323] | William Harding | books | [kindle](https://kindle.com/blah) | [5 highlights](https://amplenote.com/notes/abc333) | January 12, 2005 | [Readwise link](https://gitclear.com/bookreview/1032)`;
  const readwiseRow = plugin._bookRowContentFromReadwiseBook(null, readwiseBook1, bookNoteUUID);

  // --------------------------------------------------------------------------------------
  describe("with existing entries", () => {
    const content = `# Library Details
      - Last synced at: June 15, 2023 3:39 PM
      - Oldest update synced in: August 5, 2022
      - Next sync for content updated after: August 5, 2022
      - Readwise books imported into table: 18
      - Book count reported by Readwise: 25
      
      # ${ plugin.constants.dashboardBookListTitle }\n${ plugin._tablePreambleContent() }| ${ fauxRowMiddle } |\n| ${ fauxRowEarlier } |\n| ${ fauxRowLater } |\n${ readwiseRow }`.replace(/\n\s*/g, "\n");
    const dashboardNote = mockNote(content, plugin.constants.defaultDashboardNoteTitle, dashboardNoteUUID);
    const app = mockApp(dashboardNote);

    // --------------------------------------------------------------------------------------
    it("should migrate from generic container to specific", async () => {
      plugin._initialize();
      await plugin._migrateBooksToSections(app, dashboardNote)
      const unformatted = `# Library Details
        - Last synced at: June 15, 2023 3:39 PM
        - Oldest update synced in: August 5, 2022
        - Next sync for content updated after: August 5, 2022
        - Readwise books imported into table: 18
        - Book count reported by Readwise: 25
        # ${ plugin.constants.dashboardBookListTitle }
        ${ plugin._sectionLabelFromLastHighlight(readwiseBook1.last_highlight_at) }
        ${ plugin._tablePreambleContent() }${ readwiseRow }
        ${ plugin._sectionLabelFromLastHighlight("January 5, 2005") }
        ${ plugin._tablePreambleContent() }| ${ fauxRowLater } |
        | ${ fauxRowMiddle } |
        | ${ fauxRowEarlier } |`;
      const expectedContent = unformatted.split("\n").map(n => n.replace(/^\s*/, "")).join("\n");
      expect(dashboardNote.body).toEqual(expectedContent);
    });
  });

  // --------------------------------------------------------------------------------------
  describe("With a sparse note", () => {
    const unformatted = `# Library Details
      - Last synced at: ${ plugin._localeDateFromIsoDate(null, new Date()) }
      - Oldest update synced in: August 5, 2022
      - Next sync for content updated after: August 5, 2022
      - Readwise books imported into table: 18
      - Book count reported by Readwise: 25
      # ${ plugin.constants.dashboardBookListTitle }
      ${ plugin._sectionLabelFromLastHighlight("January 5, 2005") }
      ${ plugin._tablePreambleContent() }| ${ fauxRowLater } |
      | ${ fauxRowMiddle } |`.replace(/\n\s*/g, "\n");
    const expectedContent = unformatted.split("\n").map(n => n.replace(/^\s*/, "")).join("\n");
    const dashboardNote = mockNote(expectedContent, plugin.constants.defaultDashboardNoteTitle, dashboardNoteUUID);
    const bookNote = mockNote("", plugin._noteTitleFromBook(readwiseBook1), bookNoteUUID);
    const app = mockApp(dashboardNote);

    async function* getBook() {
      yield ({ ...readwiseBook1 })
    }

    const readwiseBookListRequest = jest.fn();
    readwiseBookListRequest.mockImplementation((app, url) => {
      const stringUrl = String(url);
      if (stringUrl.includes(plugin.constants.readwiseBookIndexURL)) {
        if (!stringUrl.includes("page=") || stringUrl.includes("page=1")) {
          return { count: 1, next: null, previous: null, results: [ readwiseBook1 ] };
        } else {
          return { count: 0, next: null, previous: null, results: [] };
        }
      } else if (stringUrl.includes(plugin.constants.readwiseHighlightsIndexURL)) {
        const bookId = stringUrl.match(/book_id=(\d+)/)[1];
        return ({
          count: 1,
          next: null,
          previous: null,
          results: [
            {
              "id": 549654155,
              "text": "Productivity is not merely some abstract economic concept. It’s at the heart of any robust economy, and central to the living standards of each of us. GDP per capita roughly captures the total amount of income generated each year within an economy. For capital-intensive economies like Alberta, an above-average share of that income is captured by capital investors and a below-average share by labour. But even using measures of average household income reveals a large gap between most Canadian provinces and U.S. states.\n\n![](https://lh3.googleusercontent.com/9ar1Rrrptx87DKOgvFNmUDvey2_RfrPanZpuuS98VqTj95FuwCaDAidBue9QE13hkO37UwrkjXaoEcwzytI0zlI7iyjQWNlc2FqeybbTTjPVv_yANSzC-JZzVZJZ3Tn52_yY4FtciMIbFLZMuQu3JfI)",
              "note": "",
              "location": 4627,
              "location_type": "offset",
              "highlighted_at": "2023-06-18T01:59:39.364724Z",
              "url": "https://read.readwise.io/read/01h361513nkws1w4npepysr0na",
              "color": "",
              "updated": "2023-06-18T01:59:39.390873Z",
              "book_id": bookId,
              "tags": []
            }
          ]
        });
      } else {
        throw new Error(`Unexpected URL: ${ url }`);
      }
    });
    plugin._readwiseMakeRequest = readwiseBookListRequest;
    plugin._readwiseFetchBooks = getBook.bind(plugin);
    plugin._testEnvironment = true;
    plugin._ensureBookNote = jest.fn().mockResolvedValue({ ...bookNote });

    // --------------------------------------------------------------------------------------
    it("should sync all books", async () => {
      const expectedDashboardContent = `# Library Details
- Last synced at: ${ plugin._localeDateFromIsoDate(null, new Date()) }
- Oldest update synced in: January 12, 2005
- Next sync for content updated after: March 28, 2012
- Readwise books imported into table: 0
- Book count reported by Readwise: 1

# Readwise Book List
## 2012 Highlights
| **Cover** | **Book Title** | **Author** | **Category** | **Source** | **Highlights** | **Updated** | **Other Details** | 
|-|-|-|-|-|-|-|-|
| ![Book cover](https://images-na.ssl-images-amazon.com/images/I/51y7BxD2f5L._SL200_.jpg) | [It's All Too Much](https://www.amplenote.com/notes/123) | Peter Walsh | books | [kindle](kindle://book?action=open&asin=B000N2HCP6) | [1 highlight](https://www.amplenote.com/notes/123#Highlights}) | March 28, 2012 | [Readwise link](https://readwise.io/bookreview/17506326) | 

## 2005 Highlights
| **Cover** | **Book Title** | **Author** | **Category** | **Source** | **Highlights** | **Updated** | **Other Details** | 
|-|-|-|-|-|-|-|-|
| ![book cover](https://www.gitclear.com/image.jpg) | [The Latest Book][https://amplenote.com/notes/123322] | William Harding | books | [kindle](https://kindle.com/blah) | [5 highlights](https://amplenote.com/notes/abc333) | February 22, 2005 | [Readwise link](https://gitclear.com/bookreview/1005) |
| ![book cover](https://www.gitclear.com/image.jpg) | [The Middle Book][https://amplenote.com/notes/123323] | William Harding | books | [kindle](https://kindle.com/blah) | [5 highlights](https://amplenote.com/notes/abc333) | January 12, 2005 | [Readwise link](https://gitclear.com/bookreview/1032) |`;
      await plugin.noteOption["Sync all"](app, dashboardNote.uuid);
      expect(dashboardNote.body).toEqual(expectedDashboardContent);
    });
  });
});
