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
      await plugin.replaceText.thesaurus(app, "query");
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
