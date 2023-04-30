import dotenv from "dotenv"
import { jest } from "@jest/globals"
import pluginObject from "./plugin"

dotenv.config();

// --------------------------------------------------------------------------------------
export const mockPlugin = () => {
  const plugin = pluginObject;
  if (plugin.insertText) {
    Object.entries(plugin.insertText).forEach(([ key, fn ]) => {
      plugin.insertText[key] = plugin.insertText[key].bind(plugin); // .insertText
    });
  }
  if (plugin.noteOption) {
    Object.entries(plugin.noteOption).forEach(([ key, fn ]) => {
      plugin.noteOption[key] = plugin.noteOption[key].bind(plugin);
    });
  }

  if (plugin.replaceText) {
    Object.entries(plugin.replaceText).forEach(([ key, fn ]) => {
      plugin.replaceText[key] = plugin.replaceText[key].bind(plugin);
    });
  }

  return plugin;
}

// --------------------------------------------------------------------------------------
export const mockApp = () => {
  const app = {};
  const openaiKey = process.env.OPEN_AI_KEY;
  if (!openaiKey) {
    console.error("Please set OPEN_AI_KEY in the .env file for tests to pass");
  }
  app.alert = text => console.error("Alert was called", text);
  app.context = {};
  app.context.noteUUID = "abc123";
  app.createNote = jest.fn();
  app.getNoteContent = jest.fn();
  app.prompt = jest.fn();
  app.notes = {};
  app.notes.find = jest.fn().mockResolvedValue(null);
  app.notes.filter = jest.fn().mockResolvedValue(null);
  app.settings = {};
  app.settings["API Key"] = openaiKey;

  return app;
}
