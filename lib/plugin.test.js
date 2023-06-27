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
  const fauxRowMiddle = `![book cover](https://www.gitclear.com/image.jpg) | [The Middle Book, A $1 Trillion Painful Risk][https://amplenote.com/notes/123323] | William Harding | books | [kindle](https://kindle.com/blah) | [5 highlights](https://amplenote.com/notes/abc333) | January 12, 2005 | [Readwise link](https://gitclear.com/bookreview/1032)`;
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
| ![book cover](https://www.gitclear.com/image.jpg) | [The Middle Book, A $1 Trillion Painful Risk][https://amplenote.com/notes/123323] | William Harding | books | [kindle](https://kindle.com/blah) | [5 highlights](https://amplenote.com/notes/abc333) | January 12, 2005 | [Readwise link](https://gitclear.com/bookreview/1032) |
`;
      await plugin.noteOption["Sync all"](app, dashboardNote.uuid);
      expect(dashboardNote.body).toEqual(expectedDashboardContent);
    });
  });

  // --------------------------------------------------------------------------------------
  describe("A dense note", () => {
    const startNoteContent = `# Library Details
      - Last synced at: June 27, 2023 7:10 AM
      - Oldest update synced in: August 5, 2022
      - Next sync for content updated after: June 14, 2023
      - Readwise books imported into table: 192
      - Book count reported by Readwise: 448
      
      # Readwise Book List
      
      | | | | | | | | |
      |-|-|-|-|-|-|-|-|
      |**Cover**|**Book Title**|**Author**|**Category**|**Source**|**Highlights**|**Updated**|**Other Details**|
      |![](https://readwise-assets.s3.amazonaws.com/static/images/article2.74d541386bbf.png)|[A Sub-Industry Signal With a Perfect Record Since 1942](https://www.amplenote.com/notes/ccc77d56-0afc-11ee-802d-b226154c413b) |campaign-archive.com|articles|[reader](https://us2.campaign-archive.com/?u=c1ba721d50cd9f9c0070e927f&id=c6c9b66194) |[1 highlight](https://www.amplenote.com/notes/ccc77d56-0afc-11ee-802d-b226154c413b#Highlights%7D) last at May 20, 2023|May 20, 2023|[Readwise link](https://readwise.io/bookreview/27958261) |
      |![](https://pbs.twimg.com/profile_images/1344775468663402497/XU5nZPfz.jpg)|[Tweets From Alf](https://www.amplenote.com/notes/cb496110-0afc-11ee-818a-b226154c413b) |@MacroAlf on Twitter|tweets|[twitter](https://twitter.com/MacroAlf) |[1 highlight](https://www.amplenote.com/notes/cb496110-0afc-11ee-818a-b226154c413b#Highlights%7D) last at May 20, 2023|May 20, 2023|[Readwise link](https://readwise.io/bookreview/27989639) |
      |![](https://pbs.twimg.com/profile_images/1617700070710992896/pF3T_gMB.jpg)|[Tweets From Rowan Cheung](https://www.amplenote.com/notes/c9d1212e-0afc-11ee-af14-b226154c413b) |@rowancheung on Twitter|tweets|[twitter](https://twitter.com/rowancheung) |[1 highlight](https://www.amplenote.com/notes/c9d1212e-0afc-11ee-af14-b226154c413b#Highlights%7D) last at May 20, 2023|May 20, 2023|[Readwise link](https://readwise.io/bookreview/27989640) |
      |![](https://pbs.twimg.com/profile_images/1463499282036756482/D3nSbqZb.jpg)|[Tweets From Josh Wolfe](https://www.amplenote.com/notes/c6e44afe-0afc-11ee-8878-b226154c413b) |@wolfejosh on Twitter|tweets|[twitter](https://twitter.com/wolfejosh) |[1 highlight](https://www.amplenote.com/notes/c6e44afe-0afc-11ee-8878-b226154c413b#Highlights%7D) last at May 20, 2023|May 20, 2023|[Readwise link](https://readwise.io/bookreview/27989641) |
      |![](https://images-na.ssl-images-amazon.com/images/I/519o80l8cHL._SL200_.jpg)|[The Match King](https://www.amplenote.com/notes/c563132c-0afc-11ee-aa53-b226154c413b) |Frank Partnoy|books|[kindle](kindle://book?action=open&asin=B0097DDXH8) |[10 highlights](https://www.amplenote.com/notes/c563132c-0afc-11ee-aa53-b226154c413b#Highlights%7D) last at May 19, 2023|May 21, 2023|[Readwise link](https://readwise.io/bookreview/28002254) |
      |![](https://assets.realclear.com/images/61/611782_5_.jpeg)|[Democrats Beware: Victory Would Endow Trump With a Strength Only Adversity Can Create](https://www.amplenote.com/notes/c3db4c0e-0afc-11ee-9a23-b226154c413b) |Conrad Black|articles|[reader](https://www.realclearpolitics.com/articles/2023/05/18/democrats_beware_victory_would_endow_trump_with_a_strength_only_adversity_can_create_149247.html?utm_source=the-flag.beehiiv.com&utm_medium=newsletter&utm_campaign=the-ceiling-is-closing-in) |[1 highlight](https://www.amplenote.com/notes/c3db4c0e-0afc-11ee-9a23-b226154c413b#Highlights%7D) last at May 22, 2023|May 22, 2023|[Readwise link](https://readwise.io/bookreview/28047268) |
      |![](https://assets.bwbx.io/images/users/iqjWHBFdfxIU/ie7W0TYPrZ08/v1/1200x800.jpg)|[When You're in a Cold War, Play for Time](https://www.amplenote.com/notes/c053db46-0afc-11ee-a777-b226154c413b) |Niall Ferguson|articles|[reader](https://www.bloomberg.com/opinion/articles/2023-05-21/us-china-rivalry-economics-says-biden-s-new-de-risking-will-work) |[3 highlights](https://www.amplenote.com/notes/c053db46-0afc-11ee-a777-b226154c413b#Highlights%7D) last at May 22, 2023|May 22, 2023|[Readwise link](https://readwise.io/bookreview/28068080) |
      |![](https://substackcdn.com/image/fetch/w_1200,h_600,c_fill,f_jpg,q_auto:good,fl_progressive:steep,g_auto/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F84ab7f8d-dbb7-4f52-a65e-bcf9ab96d929_1765x1158.png)|[Ju-N-Ior Own Out Here](https://www.amplenote.com/notes/bed449cc-0afc-11ee-b586-b226154c413b) |WTIRealist|articles|[reader](https://wtirealist.substack.com/p/ju-n-ior-own-out-here?utm_source=post-email-title&publication_id=1114715&post_id=123583903&isFreemail=false&utm_medium=email) |[1 highlight](https://www.amplenote.com/notes/bed449cc-0afc-11ee-b586-b226154c413b#Highlights%7D) last at June 2, 2023|June 2, 2023|[Readwise link](https://readwise.io/bookreview/28509942) |
      |![](https://pbs.twimg.com/profile_images/1454103621516206083/_klMwpkk.jpg)|[Tweets From Peter Yang](https://www.amplenote.com/notes/bd4ac7d4-0afc-11ee-b995-b226154c413b) |@petergyang on Twitter|tweets|[twitter](https://twitter.com/petergyang) |[1 highlight](https://www.amplenote.com/notes/bd4ac7d4-0afc-11ee-b995-b226154c413b#Highlights%7D) last at June 3, 2023|June 3, 2023|[Readwise link](https://readwise.io/bookreview/28567421) |
      |![](https://i.ytimg.com/vi/KWS-Tecjxdk/maxresdefault.jpg)|[The Best MEAL to Clear Out Your Arteries](https://www.amplenote.com/notes/bbcaaadc-0afc-11ee-8604-b226154c413b) |Dr. Eric Berg DC|articles|[reader](https://www.youtube.com/watch?v=KWS-Tecjxdk) |[1 highlight](https://www.amplenote.com/notes/bbcaaadc-0afc-11ee-8604-b226154c413b#Highlights%7D) last at June 4, 2023|June 4, 2023|[Readwise link](https://readwise.io/bookreview/28585896) |
      |![](https://inflationguy.blog/wp-content/uploads/2023/06/usswit10.jpg)|[CPI Swaps Improving? Not as Significant as You Think](https://www.amplenote.com/notes/ba3f23be-0afc-11ee-8ade-b226154c413b) |Michael Ashton|articles|[reader](https://inflationguy.blog/2023/06/07/cpi-swaps-improving-not-as-significant-as-you-think/) |[4 highlights](https://www.amplenote.com/notes/ba3f23be-0afc-11ee-8ade-b226154c413b#Highlights%7D) last at June 8, 2023|June 8, 2023|[Readwise link](https://readwise.io/bookreview/28750771) |
      |![](https://m.media-amazon.com/images/I/81dL13NFc3L._SY160.jpg)|[Young Forever](https://www.amplenote.com/notes/b720e884-0afc-11ee-b33e-b226154c413b) |Mark  Hyman M.D.|books|[kindle](kindle://book?action=open&asin=B0B38RNL7W) |[44 highlights](https://www.amplenote.com/notes/b720e884-0afc-11ee-b33e-b226154c413b#Highlights%7D) last at June 9, 2023|June 9, 2023|[Readwise link](https://readwise.io/bookreview/28818662) |
      |![](https://pbs.twimg.com/profile_images/72647502/tyler.jpg)|[Software VP Fired for Using 'Assigned by God' as Preferred...](https://www.amplenote.com/notes/b57ff380-0afc-11ee-be99-b226154c413b) |zerohedge|articles|[reader](https://twitter.com/zerohedge/status/1667600051328151553?t=lJnIEDPmrxXlfR-0REoVCA&s=09) |[0 highlights](https://www.amplenote.com/notes/b57ff380-0afc-11ee-be99-b226154c413b#Highlights%7D) last at June 10, 2023|June 10, 2023|[Readwise link](https://readwise.io/bookreview/28853509) |
      |![](https://readwise-assets.s3.amazonaws.com/static/images/article3.5c705a01b476.png)|[Cachefinance Custom Function](https://www.amplenote.com/notes/b29002d2-0afc-11ee-a770-b226154c413b) |Advanced Google Sheets Custom Functions|articles|[reader](https://demmings.github.io/notes/cachefinance.html) |[1 highlight](https://www.amplenote.com/notes/b29002d2-0afc-11ee-a770-b226154c413b#Highlights%7D) last at June 12, 2023|June 12, 2023|[Readwise link](https://readwise.io/bookreview/28921803) |
      |![](https://proto.life/wp-content/uploads/2023/05/organs-aging-longevity-epigenetics-horvath-clock-dunedinpace.jpg)|[Age at Different Rates](https://www.amplenote.com/notes/b10484d8-0afc-11ee-b4a1-b226154c413b) |Robin Donovan|articles|[reader](https://proto.life/2023/05/human-organs-age-at-different-rates/?utm_source=proto.life&utm_campaign=02e8f49c72-EMAIL_CAMPAIGN_2023_05_24_08_00&utm_medium=email&utm_term=0_-02e8f49c72-%5BLIST_EMAIL_ID%5D) |[1 highlight](https://www.amplenote.com/notes/b10484d8-0afc-11ee-b4a1-b226154c413b#Highlights%7D) last at June 12, 2023|June 12, 2023|[Readwise link](https://readwise.io/bookreview/28924062) |
      |![](https://fruitman.ca/wp-content/themes/fruitmankates/images/favicon.ico)|[June 2023 Tax Newsletter](https://www.amplenote.com/notes/af7dae0a-0afc-11ee-aa7c-b226154c413b) |Elina|articles|[reader](https://fruitman.ca/june-2023-tax-newsletter/) |[1 highlight](https://www.amplenote.com/notes/af7dae0a-0afc-11ee-aa7c-b226154c413b#Highlights%7D) last at June 12, 2023|June 12, 2023|[Readwise link](https://readwise.io/bookreview/28924958) |
      |![](https://pbs.twimg.com/profile_images/1485110155041771524/8lOa1-kp.jpg)|[Tweets From obront.eth](https://www.amplenote.com/notes/ac5ca44c-0afc-11ee-91f5-b226154c413b) |@zachobront on Twitter|tweets|[twitter](https://twitter.com/zachobront) |[1 highlight](https://www.amplenote.com/notes/ac5ca44c-0afc-11ee-91f5-b226154c413b#Highlights%7D) last at June 13, 2023|June 13, 2023|[Readwise link](https://readwise.io/bookreview/28949845) |
      |![](https://pbs.twimg.com/profile_images/1433609933698781185/sfPxmZ22.jpg)|[Tweets From ʎllǝuuop Ʇuǝɹq](https://www.amplenote.com/notes/aadd3280-0afc-11ee-b097-b226154c413b) |@donnelly_brent on Twitter|tweets|[twitter](https://twitter.com/donnelly_brent) |[1 highlight](https://www.amplenote.com/notes/aadd3280-0afc-11ee-b097-b226154c413b#Highlights%7D) last at June 13, 2023|June 13, 2023|[Readwise link](https://readwise.io/bookreview/28951855) |
      |![](https://substackcdn.com/image/fetch/w_1200,h_600,c_fill,f_jpg,q_auto:good,fl_progressive:steep,g_auto/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Ff6bda85b-e95b-4122-8aed-95659d4963c7_2400x1350.png)|[Coal the Beneficiary of Dumb Energy Policy](https://www.amplenote.com/notes/a954c950-0afc-11ee-bdc4-b226154c413b) |Ferg|articles|[reader](https://traderferg.substack.com/p/coal-the-beneficiary-of-dumb-energy?utm_source=post-email-title&publication_id=1452597&post_id=127502153&isFreemail=true&utm_medium=email) |[2 highlights](https://www.amplenote.com/notes/a954c950-0afc-11ee-bdc4-b226154c413b#Highlights%7D) last at June 13, 2023|June 13, 2023|[Readwise link](https://readwise.io/bookreview/28961048) |
      |![](https://substack-post-media.s3.amazonaws.com/public/images/4d224e76-e29b-4562-9eca-efd9797fe6ce_1920x1080.webp)|[Why AI Will Save the World](https://www.amplenote.com/notes/3ac1896c-0b90-11ee-b535-b226154c413b) |Marc Andreessen|articles|[reader](https://pmarca.substack.com/p/why-ai-will-save-the-world) |[1 highlight](https://www.amplenote.com/notes/3ac1896c-0b90-11ee-b535-b226154c413b#Highlights%7D) last at June 14, 2023 6:54 PM|June 14, 2023 6:54 PM|[Readwise link](https://readwise.io/bookreview/29021367) |
      |![](https://images-na.ssl-images-amazon.com/images/I/51NVtjOrnqL._SL200_.jpg)|[How to Win Friends and Influence People](https://www.amplenote.com/notes/f0bddfee-019b-11ee-b968-8e37e8b27b1d) |Dale Carnegie|books|[kindle](kindle://book?action=open&asin=B003WEAI4E) |[2 highlights](https://www.amplenote.com/notes/f0bddfee-019b-11ee-b968-8e37e8b27b1d#Highlights%7D) last at October 12, 2017|August 5, 2022|[Readwise link](https://readwise.io/bookreview/17506311) |
      |![](https://images-na.ssl-images-amazon.com/images/I/51RMB62o8UL._SL200_.jpg)|[The Better Angels of Our Nature](https://www.amplenote.com/notes/f0a27ff6-019b-11ee-99dd-0616632fade1) |Steven Pinker|books|[kindle](kindle://book?action=open&asin=B0052REUW0) |[8 highlights](https://www.amplenote.com/notes/f0a27ff6-019b-11ee-99dd-0616632fade1#Highlights%7D) last at May 20, 2017|August 5, 2022|[Readwise link](https://readwise.io/bookreview/17506312) |
      |![](https://images-na.ssl-images-amazon.com/images/I/41IZXFHafnL._SL200_.jpg)|[The New New Thing](https://www.amplenote.com/notes/f084d9f6-019b-11ee-b968-8e37e8b27b1d) |Michael Lewis|books|[kindle](kindle://book?action=open&asin=B000RH0CA4) |[1 highlight](https://www.amplenote.com/notes/f084d9f6-019b-11ee-b968-8e37e8b27b1d#Highlights%7D) last at May 11, 2017|August 5, 2022|[Readwise link](https://readwise.io/bookreview/17506313) |
      |![](https://images-na.ssl-images-amazon.com/images/I/5145ij9zcwL._SL200_.jpg)|[No Ordinary Time](https://www.amplenote.com/notes/f067ca5a-019b-11ee-b968-8e37e8b27b1d) |Doris Kearns Goodwin|books|[kindle](kindle://book?action=open&asin=B002HJV79U) |[10 highlights](https://www.amplenote.com/notes/f067ca5a-019b-11ee-b968-8e37e8b27b1d#Highlights%7D) last at October 7, 2016|August 5, 2022|[Readwise link](https://readwise.io/bookreview/17506314) |
      |![](https://images-na.ssl-images-amazon.com/images/I/41JQMgnwiyL._SL200_.jpg)|[The Vital Question](https://www.amplenote.com/notes/f04e3e28-019b-11ee-b968-8e37e8b27b1d) |Nick Lane|books|[kindle](kindle://book?action=open&asin=B00OD8Z4JW) |[3 highlights](https://www.amplenote.com/notes/f04e3e28-019b-11ee-b968-8e37e8b27b1d#Highlights%7D) last at October 4, 2016|August 5, 2022|[Readwise link](https://readwise.io/bookreview/17506315) |
      |![](https://images-na.ssl-images-amazon.com/images/I/51irORugtaL._SL200_.jpg)|[Andrew Jackson](https://www.amplenote.com/notes/f032bb30-019b-11ee-b968-8e37e8b27b1d) |H. W. Brands|books|[kindle](kindle://book?action=open&asin=B000MAH5K6) |[4 highlights](https://www.amplenote.com/notes/f032bb30-019b-11ee-b968-8e37e8b27b1d#Highlights%7D) last at February 26, 2016|August 5, 2022|[Readwise link](https://readwise.io/bookreview/17506316) |
      |![](https://images-na.ssl-images-amazon.com/images/I/41yxEJeaLbL._SL200_.jpg)|[Being Nixon](https://www.amplenote.com/notes/f000ddfe-019b-11ee-99dd-0616632fade1) |Evan Thomas|books|[kindle](kindle://book?action=open&asin=B00UEL0J0G) |[10 highlights](https://www.amplenote.com/notes/f000ddfe-019b-11ee-99dd-0616632fade1#Highlights%7D) last at December 23, 2015|August 5, 2022|[Readwise link](https://readwise.io/bookreview/17506317) |
      |![](https://images-na.ssl-images-amazon.com/images/I/51OzcNiKThL._SL200_.jpg)|[American Icon](https://www.amplenote.com/notes/efe6a7ea-019b-11ee-b968-8e37e8b27b1d) |Bryce G. Hoffman|books|[kindle](kindle://book?action=open&asin=B005723KGW) |[2 highlights](https://www.amplenote.com/notes/efe6a7ea-019b-11ee-b968-8e37e8b27b1d#Highlights%7D) last at October 19, 2015|August 5, 2022|[Readwise link](https://readwise.io/bookreview/17506318) |
      |![](https://images-na.ssl-images-amazon.com/images/I/512xjHhcZLL._SL200_.jpg)|[The Second Machine Age](https://www.amplenote.com/notes/efc6599a-019b-11ee-b968-8e37e8b27b1d) |Erik Brynjolfsson, Andrew McAfee|books|[kindle](kindle://book?action=open&asin=B00D97HPQI) |[1 highlight](https://www.amplenote.com/notes/efc6599a-019b-11ee-b968-8e37e8b27b1d#Highlights%7D) last at August 14, 2015|August 5, 2022|[Readwise link](https://readwise.io/bookreview/17506319) |
      |![](https://media.zenfs.com/en/insidermonkey.com/fa2dc2d7ba722044d4321a66deebe1e6)|[SFL Corporation Ltd. (NYSE:SFL) Q1 2023 Earnings Call Transcript](https://www.amplenote.com/notes/e378193e-0afc-11ee-b242-b226154c413b) |Yahoo Finance|articles|[reader](https://finance.yahoo.com/news/sfl-corporation-ltd-nyse-sfl-164127934.html) |[4 highlights](https://www.amplenote.com/notes/e378193e-0afc-11ee-b242-b226154c413b#Highlights%7D) last at May 19, 2023|May 19, 2023|[Readwise link](https://readwise.io/bookreview/27931207) |
      |![](https://i.ytimg.com/vi/bMAm2S1M_IU/maxresdefault.jpg?sqp=-oaymwEmCIAKENAF8quKqQMa8AEB-AH-CYAC0AWKAgwIABABGGUgUShMMA8=&rs=AOn4CLBXWG5ibGSQJwHP-UNmRDjBEqe0RA)|[Sohn 2023 , Kiril Sokoloff in Conversation With Stanley Druckenmiller](https://www.amplenote.com/notes/e51527a0-0afc-11ee-934b-b226154c413b) |Sohn Conference Foundation|articles|[reader](https://m.youtube.com/watch?v=bMAm2S1M_IU) |[0 highlights](https://www.amplenote.com/notes/e51527a0-0afc-11ee-934b-b226154c413b#Highlights%7D) last at May 19, 2023|May 19, 2023|[Readwise link](https://readwise.io/bookreview/27925133) |
      |![](http://www.bnnbloomberg.ca/polopoly_fs/1.1921850!/fileimage/httpImage/image.png_gen/derivatives/landscape_620/image.png)|[A $1 Trillion T-Bill Deluge Is Painful Risk of a Debt-Limit Deal](https://www.amplenote.com/notes/e69e0376-0afc-11ee-9e76-b226154c413b) |Bloomberg News|articles|[reader](https://www.bnnbloomberg.ca/a-1-trillion-t-bill-deluge-is-painful-risk-of-a-debt-limit-deal-1.1921849) |[2 highlights](https://www.amplenote.com/notes/e69e0376-0afc-11ee-9e76-b226154c413b#Highlights%7D) last at May 19, 2023|May 19, 2023|[Readwise link](https://readwise.io/bookreview/27919543) |
      |![](https://podcast-notes-uploads.s3.amazonaws.com/2023/05/09073905/napoleon.png)|[Napoleon Speaking Directly to You , Founders Podcast With David Senra](https://www.amplenote.com/notes/e8257f58-0afc-11ee-9b09-b226154c413b) |Dario|articles|[reader](https://podcastnotes.org/founders-podcast/napoleon-speaking-directly-to-you-founders-podcast-with-david-senra-302/?ck_subscriber_id=1801273922&utm_source=convertkit&utm_medium=email&utm_campaign=%F0%9F%93%9D++Tiger+Woods%2C+Napoleon%2C+Huberman+on+Shrooms%2C+RFK+Jr.%2C+VWAP%2C+Robert+Lustig+and+More+%28Free%29%20-%2010771188) |[0 highlights](https://www.amplenote.com/notes/e8257f58-0afc-11ee-9b09-b226154c413b#Highlights%7D) last at May 17, 2023|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27851513) |
      |![](https://images-na.ssl-images-amazon.com/images/I/51qAcegHfRL._SL200_.jpg)|[Kindle User's Guide](https://www.amplenote.com/notes/e9aca96e-0afc-11ee-9d82-b226154c413b) |Amazon.com|books|[kindle](kindle://book?action=open&asin=B003O86FMM) |[0 highlights](https://www.amplenote.com/notes/e9aca96e-0afc-11ee-9d82-b226154c413b#Highlights%7D) |May 17, 2023|[Readwise link](https://readwise.io/bookreview/27849034) |
      |![](https://m.media-amazon.com/images/I/51sBKNrePsL._SY160.jpg)|[The Man in the White Sharkskin Suit](https://www.amplenote.com/notes/eb34d644-0afc-11ee-8a85-b226154c413b) |Lucette Lagnado|books|[kindle](kindle://book?action=open&asin=B000SCHBR0) |[1 highlight](https://www.amplenote.com/notes/eb34d644-0afc-11ee-8a85-b226154c413b#Highlights%7D) last at September 3, 2011|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27849031) |
      |![](https://images-na.ssl-images-amazon.com/images/I/51uQagsoT2L._SL200_.jpg)|[How God Changes Your Brain](https://www.amplenote.com/notes/ecc17670-0afc-11ee-931d-b226154c413b) |Andrew Newberg M.D. and Mark Robert Waldman|books|[kindle](kindle://book?action=open&asin=B001Y35GDS) |[1 highlight](https://www.amplenote.com/notes/ecc17670-0afc-11ee-931d-b226154c413b#Highlights%7D) last at December 20, 2011|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27849029) |
      |![](https://images-na.ssl-images-amazon.com/images/I/51q2mafSTkL._SL200_.jpg)|[Disrupted](https://www.amplenote.com/notes/09ee24ca-0c9a-11ee-9c09-b226154c413b) |Dan Lyons|books|[kindle](kindle://book?action=open&asin=B013CATZIC) |[11 highlights](https://www.amplenote.com/notes/09ee24ca-0c9a-11ee-9c09-b226154c413b#Highlights%7D) last at March 14, 2017|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848744) |
      |![](https://images-na.ssl-images-amazon.com/images/I/51S%2BHXH3TzL._SL200_.jpg)|[The Wealth of Humans](https://www.amplenote.com/notes/0baccde8-0c9a-11ee-b46e-b226154c413b) |Ryan Avent|books|[kindle](kindle://book?action=open&asin=B0166SLTB8) |[19 highlights](https://www.amplenote.com/notes/0baccde8-0c9a-11ee-b46e-b226154c413b#Highlights%7D) last at March 15, 2017|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848743) |
      |![](https://images-na.ssl-images-amazon.com/images/I/517BL18A2KL._SL200_.jpg)|[Just Mercy](https://www.amplenote.com/notes/0d5f5f98-0c9a-11ee-81b2-b226154c413b) |Bryan Stevenson|books|[kindle](kindle://book?action=open&asin=B00JYWVYLY) |[14 highlights](https://www.amplenote.com/notes/0d5f5f98-0c9a-11ee-81b2-b226154c413b#Highlights%7D) last at March 15, 2017|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848741) |
      |![](https://images-na.ssl-images-amazon.com/images/I/41ZYX8t1OkL._SL200_.jpg)|[When Breath Becomes Air](https://www.amplenote.com/notes/83790d46-0c9a-11ee-ac73-b226154c413b) |Paul Kalanithi|books|[kindle](kindle://book?action=open&asin=B00XSSYR50) |[21 highlights](https://www.amplenote.com/notes/83790d46-0c9a-11ee-ac73-b226154c413b#Highlights%7D) last at March 20, 2017|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848739) |
      |![](https://images-na.ssl-images-amazon.com/images/I/418dk9QGS8L._SL200_.jpg)|[Dataclysm](https://www.amplenote.com/notes/846d9d3e-0c9a-11ee-adbd-b226154c413b) |Christian Rudder|books|[kindle](kindle://book?action=open&asin=B00J1IQUX8) |[17 highlights](https://www.amplenote.com/notes/846d9d3e-0c9a-11ee-adbd-b226154c413b#Highlights%7D) last at March 24, 2017|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848738) |
      |![](https://images-na.ssl-images-amazon.com/images/I/31dGJu-HUPL._SL200_.jpg)|[Machina](https://www.amplenote.com/notes/859ad456-0c9a-11ee-adac-b226154c413b) |Sebastian Marshall|books|[kindle](kindle://book?action=open&asin=B06XHKPKST) |[5 highlights](https://www.amplenote.com/notes/859ad456-0c9a-11ee-adac-b226154c413b#Highlights%7D) last at March 28, 2017|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848736) |
      |![](https://images-na.ssl-images-amazon.com/images/I/51lsFID%2BQPL._SL200_.jpg)|[Room](https://www.amplenote.com/notes/869c4aa6-0c9a-11ee-b536-b226154c413b) |Emma Donoghue|books|[kindle](kindle://book?action=open&asin=B003YFIUW8) |[1 highlight](https://www.amplenote.com/notes/869c4aa6-0c9a-11ee-b536-b226154c413b#Highlights%7D) last at March 28, 2017|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848732) |
      |![](https://images-na.ssl-images-amazon.com/images/I/51xrR9EOgHL._SL200_.jpg)|[The Everything Store](https://www.amplenote.com/notes/87a56fea-0c9a-11ee-be7a-b226154c413b) |Brad Stone|books|[kindle](kindle://book?action=open&asin=B00BWQW73E) |[87 highlights](https://www.amplenote.com/notes/87a56fea-0c9a-11ee-be7a-b226154c413b#Highlights%7D) last at March 29, 2017|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848730) |
      |![](https://m.media-amazon.com/images/I/71xym1pPeDL._SY160.jpg)|[Quantum Physics](https://www.amplenote.com/notes/8afa5b10-0c9a-11ee-a0a5-b226154c413b) |Alistair Rae|books|[kindle](kindle://book?action=open&asin=B0052TNZA6) |[27 highlights](https://www.amplenote.com/notes/8afa5b10-0c9a-11ee-a0a5-b226154c413b#Highlights%7D) last at March 29, 2017|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848728) |
      |![](https://images-na.ssl-images-amazon.com/images/I/41o0Fkf%2BvfL._SL200_.jpg)|[Ego Is the Enemy](https://www.amplenote.com/notes/8de9388c-0c9a-11ee-afc6-b226154c413b) |Ryan Holiday|books|[kindle](kindle://book?action=open&asin=B015NTIXWE) |[16 highlights](https://www.amplenote.com/notes/8de9388c-0c9a-11ee-afc6-b226154c413b#Highlights%7D) last at March 29, 2017|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848726) |
      |![](https://images-na.ssl-images-amazon.com/images/I/51Rrunt9P8L._SL200_.jpg)|[As a Man Thinketh](https://www.amplenote.com/notes/90e31cce-0c9a-11ee-9364-b226154c413b) |James Allen|books|[kindle](kindle://book?action=open&asin=B001C33UZG) |[2 highlights](https://www.amplenote.com/notes/90e31cce-0c9a-11ee-9364-b226154c413b#Highlights%7D) last at April 6, 2017|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848722) |
      |![](https://images-na.ssl-images-amazon.com/images/I/41qANxacOkL._SL200_.jpg)|[Essentialism](https://www.amplenote.com/notes/93edbb40-0c9a-11ee-8fd9-b226154c413b) |Greg McKeown|books|[kindle](kindle://book?action=open&asin=B00G1J1D28) |[30 highlights](https://www.amplenote.com/notes/93edbb40-0c9a-11ee-8fd9-b226154c413b#Highlights%7D) last at April 19, 2017|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848720) |
      |![](https://images-na.ssl-images-amazon.com/images/I/61NUh6EuKsL._SL200_.jpg)|[Trust Me, I'm Lying](https://www.amplenote.com/notes/9709de1c-0c9a-11ee-99e4-b226154c413b) |Ryan Holiday|books|[kindle](kindle://book?action=open&asin=B0074VTHH0) |[10 highlights](https://www.amplenote.com/notes/9709de1c-0c9a-11ee-99e4-b226154c413b#Highlights%7D) last at April 24, 2017|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848719) |
      |![](https://images-na.ssl-images-amazon.com/images/I/41uQwlQlMwL._SL200_.jpg)|[I Got There](https://www.amplenote.com/notes/981b7004-0c9a-11ee-9feb-b226154c413b) |JT McCormick and Tucker Max|books|[kindle](kindle://book?action=open&asin=B01MZ6HJG8) |[1 highlight](https://www.amplenote.com/notes/981b7004-0c9a-11ee-9feb-b226154c413b#Highlights%7D) last at May 16, 2017|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848717) |
      |![](https://images-na.ssl-images-amazon.com/images/I/51QuADmLbkL._SL200_.jpg)|[The Captain Class](https://www.amplenote.com/notes/99214f3c-0c9a-11ee-8b38-b226154c413b) |Sam Walker|books|[kindle](kindle://book?action=open&asin=B01LKCRKFY) |[42 highlights](https://www.amplenote.com/notes/99214f3c-0c9a-11ee-8b38-b226154c413b#Highlights%7D) last at June 1, 2017|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848716) |
      |![](https://images-na.ssl-images-amazon.com/images/I/516GMiTBYRL._SL200_.jpg)|[Why Zebras Don't Get Ulcers](https://www.amplenote.com/notes/9a1d3ad6-0c9a-11ee-9c09-b226154c413b) |Robert M. Sapolsky|books|[kindle](kindle://book?action=open&asin=B0037NX018) |[0 highlights](https://www.amplenote.com/notes/9a1d3ad6-0c9a-11ee-9c09-b226154c413b#Highlights%7D) |May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848714) |
      |![](https://images-na.ssl-images-amazon.com/images/I/51-s9Jx9mzL._SL200_.jpg)|[How to Win at the Sport of Business](https://www.amplenote.com/notes/9d0e38e4-0c9a-11ee-92bc-b226154c413b) |Mark Cuban|books|[kindle](kindle://book?action=open&asin=B006AX6ONI) |[2 highlights](https://www.amplenote.com/notes/9d0e38e4-0c9a-11ee-92bc-b226154c413b#Highlights%7D) last at June 22, 2017|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848713) |
      |![](https://images-na.ssl-images-amazon.com/images/I/5184HVR75iL._SL200_.jpg)|[Leadership Step by Step](https://www.amplenote.com/notes/9e0b333c-0c9a-11ee-8154-b226154c413b) |Joshua SPODEK|books|[kindle](kindle://book?action=open&asin=B01HUER0ZQ) |[1 highlight](https://www.amplenote.com/notes/9e0b333c-0c9a-11ee-8154-b226154c413b#Highlights%7D) last at June 26, 2017|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848711) |
      |![](https://images-na.ssl-images-amazon.com/images/I/41k%2BWVPLwZL._SL200_.jpg)|[Shoe Dog](https://www.amplenote.com/notes/9f009d9a-0c9a-11ee-a087-b226154c413b) |Phil Knight|books|[kindle](kindle://book?action=open&asin=B0176M1A44) |[28 highlights](https://www.amplenote.com/notes/9f009d9a-0c9a-11ee-a087-b226154c413b#Highlights%7D) last at July 16, 2017|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848708) |
      |![](https://images-na.ssl-images-amazon.com/images/I/6120t5firiL._SL200_.jpg)|[The Next Perfect Trade](https://www.amplenote.com/notes/a1b696b6-0c9a-11ee-902b-b226154c413b) |Alex Gurevich|books|[kindle](kindle://book?action=open&asin=B0152BWGSK) |[4 highlights](https://www.amplenote.com/notes/a1b696b6-0c9a-11ee-902b-b226154c413b#Highlights%7D) last at August 22, 2017|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848706) |
      |![](https://images-na.ssl-images-amazon.com/images/I/51HjaxWBOvL._SL200_.jpg)|[The Coaching Habit](https://www.amplenote.com/notes/a2b00ab6-0c9a-11ee-a6b9-b226154c413b) |Michael Bungay Stanier|books|[kindle](kindle://book?action=open&asin=B01BUIBBZI) |[54 highlights](https://www.amplenote.com/notes/a2b00ab6-0c9a-11ee-a6b9-b226154c413b#Highlights%7D) last at October 5, 2017|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848704) |
      |![](https://images-na.ssl-images-amazon.com/images/I/51s1oykwS2L._SL200_.jpg)|[The Absent Superpower](https://www.amplenote.com/notes/a3c30bb0-0c9a-11ee-b42e-b226154c413b) |Peter Zeihan|books|[kindle](kindle://book?action=open&asin=B01MTENHGT) |[53 highlights](https://www.amplenote.com/notes/a3c30bb0-0c9a-11ee-b42e-b226154c413b#Highlights%7D) last at October 5, 2017|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848701) |
      |![](https://images-na.ssl-images-amazon.com/images/I/51hSs60iPWL._SL200_.jpg)|[Leadership and Self-Deception](https://www.amplenote.com/notes/a67bdfbc-0c9a-11ee-962f-b226154c413b) |The Arbinger Institute|books|[kindle](kindle://book?action=open&asin=B00GUPYRUS) |[35 highlights](https://www.amplenote.com/notes/a67bdfbc-0c9a-11ee-962f-b226154c413b#Highlights%7D) last at October 7, 2017|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848698) |
      |![](https://images-na.ssl-images-amazon.com/images/I/51TVamX9bsL._SL200_.jpg)|[Perennial Seller](https://www.amplenote.com/notes/a7775a68-0c9a-11ee-a392-b226154c413b) |Ryan Holiday|books|[kindle](kindle://book?action=open&asin=B01N8SL7FH) |[2 highlights](https://www.amplenote.com/notes/a7775a68-0c9a-11ee-a392-b226154c413b#Highlights%7D) last at October 9, 2017|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848697) |
      |![](https://images-na.ssl-images-amazon.com/images/I/5174q-0EEYL._SL200_.jpg)|[The Runaway Species](https://www.amplenote.com/notes/a889a352-0c9a-11ee-920d-b226154c413b) |David Eagleman, Anthony Brandt|books|[kindle](kindle://book?action=open&asin=B01N16NLYM) |[13 highlights](https://www.amplenote.com/notes/a889a352-0c9a-11ee-920d-b226154c413b#Highlights%7D) last at October 20, 2017|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848695) |
      |![](https://images-na.ssl-images-amazon.com/images/I/518mXqzD1dL._SL200_.jpg)|[Diastasis Recti](https://www.amplenote.com/notes/ab3ee576-0c9a-11ee-9712-b226154c413b) |Katy Bowman|books|[kindle](kindle://book?action=open&asin=B01A00CZIE) |[17 highlights](https://www.amplenote.com/notes/ab3ee576-0c9a-11ee-9712-b226154c413b#Highlights%7D) last at October 30, 2017|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848694) |
      |![](https://images-na.ssl-images-amazon.com/images/I/41p5oWL3ryL._SL200_.jpg)|[Quiet](https://www.amplenote.com/notes/aff72c40-0c9a-11ee-962d-b226154c413b) |Susan Cain|books|[kindle](kindle://book?action=open&asin=B004J4WNL2) |[26 highlights](https://www.amplenote.com/notes/aff72c40-0c9a-11ee-962d-b226154c413b#Highlights%7D) last at November 26, 2017|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848690) |
      |![](https://images-na.ssl-images-amazon.com/images/I/513oWKJwchL._SL200_.jpg)|[Solitude](https://www.amplenote.com/notes/b294d43e-0c9a-11ee-a771-b226154c413b) |Michael Harris|books|[kindle](kindle://book?action=open&asin=B01M594GM7) |[10 highlights](https://www.amplenote.com/notes/b294d43e-0c9a-11ee-a771-b226154c413b#Highlights%7D) last at December 1, 2017|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848689) |
      |![](https://images-na.ssl-images-amazon.com/images/I/51gFt86kFAL._SL200_.jpg)|[Leonardo Da Vinci](https://www.amplenote.com/notes/b532dace-0c9a-11ee-9cc2-b226154c413b) |Walter Isaacson|books|[kindle](kindle://book?action=open&asin=B071Y385Q1) |[61 highlights](https://www.amplenote.com/notes/b532dace-0c9a-11ee-9cc2-b226154c413b#Highlights%7D) last at December 19, 2017|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848687) |
      |![](https://images-na.ssl-images-amazon.com/images/I/51OB9NtilqL._SL200_.jpg)|[In a Sunburned Country](https://www.amplenote.com/notes/b7ca5e74-0c9a-11ee-a1b3-b226154c413b) |Bill Bryson|books|[kindle](kindle://book?action=open&asin=B000Q9ISSQ) |[7 highlights](https://www.amplenote.com/notes/b7ca5e74-0c9a-11ee-a1b3-b226154c413b#Highlights%7D) last at December 21, 2017|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848685) |
      |![](https://images-na.ssl-images-amazon.com/images/I/41vS70Qo3rL._SL200_.jpg)|[Mindset](https://www.amplenote.com/notes/b8c1f9fe-0c9a-11ee-9a55-b226154c413b) |Carol S. Dweck|books|[kindle](kindle://book?action=open&asin=B000FCKPHG) |[33 highlights](https://www.amplenote.com/notes/b8c1f9fe-0c9a-11ee-9a55-b226154c413b#Highlights%7D) last at January 8, 2018|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848683) |
      |![](https://images-na.ssl-images-amazon.com/images/I/51mN3bY0JjL._SL200_.jpg)|[The Subtle Art of Not Giving a F\\*ck](https://www.amplenote.com/notes/b9c7fa74-0c9a-11ee-9ca4-b226154c413b) |Mark Manson|books|[kindle](kindle://book?action=open&asin=B019MMUA8S) |[149 highlights](https://www.amplenote.com/notes/b9c7fa74-0c9a-11ee-9ca4-b226154c413b#Highlights%7D) last at January 12, 2018|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848682) |
      |![](https://images-na.ssl-images-amazon.com/images/I/41SOglJbmmL._SL200_.jpg)|[The Art of Travel](https://www.amplenote.com/notes/d757dd88-0c9b-11ee-98fe-b226154c413b) |Alain De Botton|books|[kindle](kindle://book?action=open&asin=B001LOEFZ0) |[24 highlights](https://www.amplenote.com/notes/d757dd88-0c9b-11ee-98fe-b226154c413b#Highlights%7D) last at January 13, 2018|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848680) |
      |![](https://images-na.ssl-images-amazon.com/images/I/51leKshWMZL._SL200_.jpg)|[Exit West](https://www.amplenote.com/notes/d87facd6-0c9b-11ee-bc59-b226154c413b) |Mohsin Hamid|books|[kindle](kindle://book?action=open&asin=B01H17U9OQ) |[1 highlight](https://www.amplenote.com/notes/d87facd6-0c9b-11ee-bc59-b226154c413b#Highlights%7D) last at January 14, 2018|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848679) |
      |![](https://images-na.ssl-images-amazon.com/images/I/41v%2B00gXxyL._SL200_.jpg)|[The Miracle of Mindfulness](https://www.amplenote.com/notes/d9d39fb6-0c9b-11ee-bd2e-b226154c413b) |Thich Nhat Hanh, Vo-Dihn Mai, and Mobi Ho|books|[kindle](kindle://book?action=open&asin=B009U9S6VM) |[17 highlights](https://www.amplenote.com/notes/d9d39fb6-0c9b-11ee-bd2e-b226154c413b#Highlights%7D) last at January 19, 2018|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848678) |
      |![](https://images-na.ssl-images-amazon.com/images/I/410-jYwWdKL._SL200_.jpg)|[But What if We're Wrong?](https://www.amplenote.com/notes/e1ab09d6-0c9b-11ee-8bb4-b226154c413b) |Chuck Klosterman|books|[kindle](kindle://book?action=open&asin=B015DLUTDS) |[27 highlights](https://www.amplenote.com/notes/e1ab09d6-0c9b-11ee-8bb4-b226154c413b#Highlights%7D) last at January 26, 2018|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848675) |
      |![](https://images-na.ssl-images-amazon.com/images/I/41bEKR8AVlL._SL200_.jpg)|[Lee Kuan Yew](https://www.amplenote.com/notes/e520f4c2-0c9b-11ee-9af4-b226154c413b) |Graham Allison, Ali Wyne, Robert D. Blackwill, Henry A. Kissinger|books|[kindle](kindle://book?action=open&asin=B00BFDLH3K) |[31 highlights](https://www.amplenote.com/notes/e520f4c2-0c9b-11ee-9af4-b226154c413b#Highlights%7D) last at January 26, 2018|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848674) |
      |![](https://images-na.ssl-images-amazon.com/images/I/51JKV0OgV3L._SL200_.jpg)|[The Nightingale](https://www.amplenote.com/notes/e835e474-0c9b-11ee-9300-b226154c413b) |Kristin Hannah|books|[kindle](kindle://book?action=open&asin=B00JO8PEN2) |[1 highlight](https://www.amplenote.com/notes/e835e474-0c9b-11ee-9300-b226154c413b#Highlights%7D) last at January 31, 2018|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848673) |
      |![](https://images-na.ssl-images-amazon.com/images/I/519ZmJ9flmL._SL200_.jpg)|[The Denial of Death](https://www.amplenote.com/notes/e961581a-0c9b-11ee-a93e-b226154c413b) |Ernest Becker|books|[kindle](kindle://book?action=open&asin=B002C7Z57C) |[478 highlights](https://www.amplenote.com/notes/e961581a-0c9b-11ee-a93e-b226154c413b#Highlights%7D) last at February 4, 2018|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848672) |
      |![](https://images-na.ssl-images-amazon.com/images/I/51jAxe6vEnL._SL200_.jpg)|[Stories of Your Life and Others](https://www.amplenote.com/notes/eea024fa-0c9b-11ee-8a0d-b226154c413b) |Ted Chiang|books|[kindle](kindle://book?action=open&asin=B0048EKOP0) |[11 highlights](https://www.amplenote.com/notes/eea024fa-0c9b-11ee-8a0d-b226154c413b#Highlights%7D) last at March 4, 2018|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848669) |
      |![](https://images-na.ssl-images-amazon.com/images/I/51qQPVI4fEL._SL200_.jpg)|[The Lacuna](https://www.amplenote.com/notes/f1d91046-0c9b-11ee-ab6f-b226154c413b) |Barbara Kingsolver|books|[kindle](kindle://book?action=open&asin=B002SVQCRO) |[1 highlight](https://www.amplenote.com/notes/f1d91046-0c9b-11ee-ab6f-b226154c413b#Highlights%7D) last at March 10, 2018|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848668) |
      |![](https://images-na.ssl-images-amazon.com/images/I/51RuZLF-0dL._SL200_.jpg)|[The New Geography of Jobs](https://www.amplenote.com/notes/f34381d2-0c9b-11ee-ab6f-b226154c413b) |Enrico Moretti|books|[kindle](kindle://book?action=open&asin=B008035HQQ) |[89 highlights](https://www.amplenote.com/notes/f34381d2-0c9b-11ee-ab6f-b226154c413b#Highlights%7D) last at March 18, 2018|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848667) |
      |![](https://images-na.ssl-images-amazon.com/images/I/51HL6RW8htL._SL200_.jpg)|[The Wife, the Maid, and the Mistress](https://www.amplenote.com/notes/f8fe274e-0c9b-11ee-b54b-b226154c413b) |Ariel Lawhon|books|[kindle](kindle://book?action=open&asin=B00EBRU0AS) |[0 highlights](https://www.amplenote.com/notes/f8fe274e-0c9b-11ee-b54b-b226154c413b#Highlights%7D) |May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848664) |
      |![](https://images-na.ssl-images-amazon.com/images/I/51tqC5A8GlL._SL200_.jpg)|[Soonish](https://www.amplenote.com/notes/fcce61fe-0c9b-11ee-8234-b226154c413b) |Kelly Weinersmith , Zach Weinersmith  (Illustrator)|books|[kindle](kindle://book?action=open&asin=B06XBQ443G) |[26 highlights](https://www.amplenote.com/notes/fcce61fe-0c9b-11ee-8234-b226154c413b#Highlights%7D) last at April 27, 2018|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848663) |
      |![](https://images-na.ssl-images-amazon.com/images/I/41Mq7Ss7lPL._SL200_.jpg)|[Principles](https://www.amplenote.com/notes/ff803eae-0c9b-11ee-bc0a-b226154c413b) |Ray Dalio|books|[kindle](kindle://book?action=open&asin=B071CTK28D) |[108 highlights](https://www.amplenote.com/notes/ff803eae-0c9b-11ee-bc0a-b226154c413b#Highlights%7D) last at May 1, 2018|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848662) |
      |![](https://images-na.ssl-images-amazon.com/images/I/51HAawG52TL._SL200_.jpg)|[The Great Good Thing](https://www.amplenote.com/notes/05ed3aee-0c9c-11ee-a944-b226154c413b) |Andrew Klavan|books|[kindle](kindle://book?action=open&asin=B01864DXNC) |[9 highlights](https://www.amplenote.com/notes/05ed3aee-0c9c-11ee-a944-b226154c413b#Highlights%7D) last at May 12, 2018|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848659) |
      |![](https://images-na.ssl-images-amazon.com/images/I/51dlPO8zjtL._SL200_.jpg)|[Everybody's Son](https://www.amplenote.com/notes/089e10d8-0c9c-11ee-9dd4-b226154c413b) |Thrity Umrigar|books|[kindle](kindle://book?action=open&asin=B01LYGHD1V) |[1 highlight](https://www.amplenote.com/notes/089e10d8-0c9c-11ee-9dd4-b226154c413b#Highlights%7D) last at May 28, 2018|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848658) |
      |![](https://images-na.ssl-images-amazon.com/images/I/41oBNUkFaNL._SL200_.jpg)|[The Three Languages of Politics](https://www.amplenote.com/notes/099b8402-0c9c-11ee-9fb1-b226154c413b) |Arnold Kling|books|[kindle](kindle://book?action=open&asin=B06Y96Y26P) |[15 highlights](https://www.amplenote.com/notes/099b8402-0c9c-11ee-9fb1-b226154c413b#Highlights%7D) last at May 30, 2018|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848657) |
      |![](https://images-na.ssl-images-amazon.com/images/I/512P3KPfMjL._SL200_.jpg)|[Trump](https://www.amplenote.com/notes/0ffff756-0c9c-11ee-8169-b226154c413b) |Donald J. Trump, Tony Schwartz|books|[kindle](kindle://book?action=open&asin=B000SEGE6M) |[14 highlights](https://www.amplenote.com/notes/0ffff756-0c9c-11ee-8169-b226154c413b#Highlights%7D) last at July 6, 2018|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848654) |
      |![](https://images-na.ssl-images-amazon.com/images/I/413d-Fmu8CL._SL200_.jpg)|[How to Change Your Mind](https://www.amplenote.com/notes/12db2c20-0c9c-11ee-aaa7-b226154c413b) |Michael Pollan|books|[kindle](kindle://book?action=open&asin=B076GPJXWZ) |[34 highlights](https://www.amplenote.com/notes/12db2c20-0c9c-11ee-aaa7-b226154c413b#Highlights%7D) last at July 12, 2018|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848652) |
      |![](https://images-na.ssl-images-amazon.com/images/I/51Mt25cHFCL._SL200_.jpg)|[The Square and the Tower](https://www.amplenote.com/notes/13dbb5cc-0c9c-11ee-9351-b226154c413b) |Niall Ferguson|books|[kindle](kindle://book?action=open&asin=B073NPCBL5) |[5 highlights](https://www.amplenote.com/notes/13dbb5cc-0c9c-11ee-9351-b226154c413b#Highlights%7D) last at July 15, 2018|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848651) |
      |![](https://images-na.ssl-images-amazon.com/images/I/41%2BBQ6%2BocyL._SL200_.jpg)|[Forever Nomad](https://www.amplenote.com/notes/14db379a-0c9c-11ee-bbb6-b226154c413b) |Tynan, Rolf Potts, Derek Sivers, Leo Babauta, and Todd Iceton|books|[kindle](kindle://book?action=open&asin=B07CCNV34D) |[15 highlights](https://www.amplenote.com/notes/14db379a-0c9c-11ee-bbb6-b226154c413b#Highlights%7D) last at July 15, 2018|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848649) |
      |![](https://images-na.ssl-images-amazon.com/images/I/515uxhpBakL._SL200_.jpg)|[Everything I Never Told You](https://www.amplenote.com/notes/17776226-0c9c-11ee-8271-b226154c413b) |Celeste Ng|books|[kindle](kindle://book?action=open&asin=B00G3L7V0C) |[1 highlight](https://www.amplenote.com/notes/17776226-0c9c-11ee-8271-b226154c413b#Highlights%7D) last at July 17, 2018|May 17, 2023|[Readwise link](https://readwise.io/bookreview/27848648) |
    `.split("\n").map(n => n.replace(/^\s*/, "")).join("\n");

    const dashboardNote = mockNote(startNoteContent, plugin.constants.defaultDashboardNoteTitle, dashboardNoteUUID);
    const app = mockApp(dashboardNote);

    // --------------------------------------------------------------------------------------
    it("should migrate 100 rows", async () => {
      plugin._initialize();
      await plugin._migrateBooksToSections(app, dashboardNote)
      const unformatted = `# Library Details
        - Last synced at: June 27, 2023 7:10 AM
        - Oldest update synced in: August 5, 2022
        - Next sync for content updated after: June 14, 2023
        - Readwise books imported into table: 192
        - Book count reported by Readwise: 448

        # ${ plugin.constants.dashboardBookListTitle }       
        `;
      const expectedContent = unformatted.split("\n").map(n => n.replace(/^\s*/, "")).join("\n");
      expect(dashboardNote.body).toEqual(expectedContent);
    });
  });
});
