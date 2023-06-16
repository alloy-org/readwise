import { jest } from "@jest/globals"
import { mockPlugin, mockApp } from "./test-helpers.js"

import plugin from "./plugin.js"

// --------------------------------------------------------------------------------------
// Note that some of these tests actually make calls to OpenAI. Normally tests would be mocked for
// a remote call, but for Bill's current purposes, it's pretty useful to be able to see what the real
// API responds with as I iterate upon new possible methods
describe("plugin", () => {
  const plugin = mockPlugin();

  // --------------------------------------------------------------------------------------
  describe("with a mocked app", () => {
    const app = mockApp();

    it("should evaluate the lookup expression", async () => {
      const noteUUID = 123;
      const readwiseID = 456;
      const content = `
# Library Details
Last synced at: June 15, 2023 3:39 PM
Oldest update synced in: August 5, 2022
Next sync for content updated after: August 5, 2022
Readwise books imported into table: 18
Book count reported by Readwise: 25

# ${ plugin.constants.dashboardBookListTitle }
${ plugin._tablePreambleContent() }
| ![book cover](https://www.gitclear.com/image.jpg) | William Harding | books | [kindle](https://kindle.com/blah) | [5 highlights](https://amplenote.com/notes/abc333) | August 5, 2022 | [Readwise link](${ readwiseID }) |
| ![book cover](https://www.gitclear.com/image.jpg) | William Harding | books | [kindle](https://kindle.com/blah) | [5 highlights](https://amplenote.com/notes/abc333) | August 5, 2022 | [Readwise link](999) |
`
      const noteHandle = {
        content: () => content,
        name: plugin.constants.defaultDashboardNoteTitle,
        uuid: noteUUID,
      };
      app.findNote = jest.fn().mockResolvedValue(noteHandle);
      app.notes.find = jest.fn().mockResolvedValue(noteHandle);
      app.getNoteContent = jest.fn().mockResolvedValue(content);
      plugin._readwiseMakeRequest = jest.fn().mockResolvedValue({ count: 0 });
      async function* getBook() {
        yield* ({ something: "for sure" })
      }
      plugin._readwiseFetchBooks = getBook.bind(plugin);
      plugin._testEnvironment = true;

      app.notes.find.mockReturnValue({ content: () => content });
      const result = await plugin.noteOption["Sync all"](app, noteUUID);
      expect(result).toBe("question.");
    });
  });
});
