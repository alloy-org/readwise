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
export const mockApp = seedNote => {
  const app = {};
  app.alert = text => console.error("Alert was called", text);
  app.context = {};
  app.context.noteUUID = "abc123";
  app.createNote = jest.fn();
  app.getNoteContent = jest.fn();
  app.prompt = jest.fn();
  app.navigate = jest.fn();
  app.notes = {};
  app.notes.find = jest.fn().mockResolvedValue(null);
  app.notes.filter = jest.fn().mockResolvedValue(null);
  app.settings = {};

  if (seedNote) {
    const noteFunction = jest.fn();
    noteFunction.mockImplementation(noteHandle => {
      if (typeof noteHandle === "string") {
        if (parseInt(noteHandle) === seedNote.uuid) {
          return seedNote;
        }
        return null;
      } else if (typeof noteHandle === "number") {
        if (noteHandle === seedNote.uuid) {
          return seedNote;
        }
        return null;
      } else {
        if (noteHandle.uuid === seedNote.uuid) {
          return seedNote;
        } else if (noteHandle.name === seedNote.name) {
          return seedNote;
        }
        return null;
      }
    });
    const getContent = jest.fn();
    getContent.mockImplementation(noteHandle => {
      if (noteHandle.uuid === seedNote.uuid) {
        return seedNote.content();
      }
      return null;
    });

    app.findNote = noteFunction;
    app.notes.find = noteFunction;
    app.getNoteContent = getContent;
  }

  return app;
}

// --------------------------------------------------------------------------------------
export const mockNote = (content, name, uuid) => {
  const note = {};
  note.body = content;
  note.name = name;
  note.uuid = uuid;
  note.content = () => note.body;

  // --------------------------------------------------------------------------------------
  note.insertContent = async (newContent, options = {}) => {
    if (options.atEnd) {
      note.body += newContent;
    } else {
      note.body = `${ note.body }\n${ newContent }`;
    }
  }

  // --------------------------------------------------------------------------------------
  note.replaceContent = async (newContent, sectionObject = null) => {
    if (sectionObject) {
      const sectionHeadingText = sectionObject.section.heading.text;
      let throughLevel = sectionObject.section.heading?.level;
      if (!throughLevel) throughLevel = sectionHeadingText.match(/^#*/)[0].length;
      if (!throughLevel) throughLevel = 1;

      const indexes = Array.from(note.body.matchAll(/^#+\s*([^#\n\r]+)/gm));
      const sectionMatch = indexes.find(m => m[1].trim() === sectionHeadingText.trim());
      let startIndex, endIndex;
      if (!sectionMatch) {
        throw new Error(`Could not find section ${ sectionHeadingText } that was looked up. This might be expected`);
      } else {
        const level = sectionMatch[0].match(/^#+/)[0].length;
        const nextMatch = indexes.find(m => m.index > sectionMatch.index && m[0].match(/^#+/)[0].length <= level);
        endIndex = nextMatch ? nextMatch.index : note.body.length;
        startIndex = sectionMatch.index + sectionMatch[0].length + 1;
      }

      if (Number.isInteger(startIndex)) {
        const revisedContent = `${ note.body.slice(0, startIndex) }${ newContent.trim() }\n${ note.body.slice(endIndex) }`;
        note.body = revisedContent;
      } else {
        throw new Error(`Could not find section ${ sectionObject.section.heading.text } in note ${ note.name }`);
      }
    } else {
      note.body = newContent;
    }
  };

  // --------------------------------------------------------------------------------------
  note.sections = async () => {
    const headingMatches = note.body.matchAll(/^#+\s*([^\n]+)/gm);
    return Array.from(headingMatches).map(match => ({
      anchor: match[1].replace(/\s/g, "_"),
      level: /^#+/.exec(match[0]).length,
      text: match[1],
    }));
  }
  return note;
}
