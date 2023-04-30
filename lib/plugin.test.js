import { jest } from "@jest/globals"
import { mockPlugin, mockApp } from "./test-helpers.js"

// --------------------------------------------------------------------------------------
// Note that some of these tests actually make calls to OpenAI. Normally tests would be mocked for
// a remote call, but for Bill's current purposes, it's pretty useful to be able to see what the real
// API responds with as I iterate upon new possible methods
describe("plugin", () => {
  const plugin = mockPlugin();

  // --------------------------------------------------------------------------------------
  describe("with a mocked app", () => {
    const app = mockApp();

    it("should look up thesaurus entries from trivial input", async () => {
      const noteHandles = [ {
        noteHandle: { name: "War and Peace by Tolstoy (RID #23)", uuid: "abc123" },
        content: jest.fn().mockResolvedValue(`
          Author: Leo Tolstoy
          Title: War and Peace
          Date: 1869
          Book ID: 23

          ### Yo mama so fat, she a multi-part download
          Highlighted at: January 3, 2021 12:00 AM
          Readwise URL: https://readwise.io/abc123 
        `)
      } ];
      app.notes.filter = jest.fn().mockResolvedValue(noteHandles)
      await plugin.noteOption["Sync Readwise"](app, "abc123");

    });

    it("should evaluate the lookup expression", async () => {
      app.notes.find.mockReturnValue({
        content: () => `To be, or not to be, that is the {${ plugin.constants.pluginName }: lookup}.`
      });
      const result = await plugin.insertText.lookup(app);
      expect(result).toBe("question.");
    });
  });
});
