import fetch from "isomorphic-fetch"

// Latest docs https://www.amplenote.com/help/developing_amplenote_plugins
const plugin = {
  // --------------------------------------------------------------------------------------
  constants: {
    defaultSystemPrompt: "You are a helpful assistant.",
    generatedImageCount: 3,
    pluginName: "Yappy",
    strictReplacePromptEms: [ "lookup", "sum", "thesaurus" ],
    tokenReplacePrompts: {
      code: `Provide a snippet of source code (in either Javascript, Python or Ruby) implementing
      the intent of the text preceding the token. Use the triple backtick to begin and end your code.`,
      lolz: `Provide up to 100 words of entertaining, humorous content that is a little bit edgy. 
      Reference other text in the document provided to show how well you understand it, especially the text 
      near the replace token. If you can't figure out a funny joke, insert a four line limerick, song, 
      poem, or rap that is relevant to the nearby text.`,
      sum: `Calculate the sum of the table cells in the row or column of the token.  Respond only with plain text 
      to be placed in the table cell. If the summed cells contain a unit, include that unit in your response. The 
      limit of your response is 20 characters. If you can not find numbers to sum, respond with "🤔"`,
    },
  },

  // --------------------------------------------------------------------------------------
  _systemPrompts: {
    replaceTextComplete: "You are a helpful assistant helping continue writing markdown-formatted content.",
    reviseContent: "You are a helpful assistant that revises markdown-formatted content, as instructed.",
    reviseText: "You are a helpful assistant that revises text, as instructed.",
    summarize: "You are a helpful assistant that summarizes notes that are markdown-formatted.",
  },

  // --------------------------------------------------------------------------------------
  _userPrompts: {
    replaceTextComplete: content => `Continue the following markdown-formatted content:\n\n${ content }`,
    reviseContent: ([ instruction, content ]) => [ instruction, content ],
    reviseText: ([ instruction, text ]) => [ instruction, text ],
    summarize: content => `Summarize the following markdown-formatted note:\n\n${ content }`,
  },

  // --------------------------------------------------------------------------------------
  insertText: {
    lolz: async function(app) {
      return await this._contextAwarePrompt(app, "lolz");
    },
    code: async function(app) {
      return await this._contextAwarePrompt(app, "code");
    },
    complete: async function(app) {
      return await this._contextAwarePrompt(app, "complete");
    },
    image: async function(app) {
      const instruction = await app.prompt("What would you like to generate images of?");
      if (!instruction) return;
      return await this._insertImagePrompt(app, instruction);
    },
    lookup: async function(app) {
      return await this._contextAwarePrompt(app, "lookup");
    },
    sum: async function(app) {
      return await this._contextAwarePrompt(app, "sum");
    },
  },

  // --------------------------------------------------------------------------------------
  // https://www.amplenote.com/help/developing_amplenote_plugins#noteOption
  noteOption: {
    "revise": async function(app, noteUUID) {
      const instruction = await app.prompt("How should this note be revised?");
      if (!instruction) return;

      const note = await app.notes.find(noteUUID);
      const noteContent = await note.content();
      const result = await this._callOpenAICompletion(app, "reviseContent", [ instruction, noteContent ]);
      const actionIndex = await app.alert(result, {
        actions: [ { icon: "post_add", label: "Insert in note" } ]
      });
      if (actionIndex === 0) {
        note.insertContent(result);
      }
    },
    "summarize": async function(app, noteUUID) {
      const note = await app.notes.find(noteUUID);
      const noteContent = await note.content();
      const result = await this._callOpenAICompletion(app, "summarize", noteContent);
      const actionIndex = await app.alert(result, {
        actions: [ { icon: "post_add", label: "Insert in note" } ]
      });
      if (actionIndex === 0) {
        note.insertContent(result);
      }
    },
  },

  // --------------------------------------------------------------------------------------
  // https://www.amplenote.com/help/developing_amplenote_plugins#replaceText
  replaceText: {
    "complete": async function(app, text) {
      const result = await this._callOpenAICompletion(app, "replaceTextComplete", text);
      return text + " " + result;
    },
    "revise": async function(app, text) {
      const instruction = await app.prompt("How should this text be revised?");
      if (!instruction) return null;

      const result = await this._callOpenAICompletion(app, "reviseText", [ instruction, text ]);

      app.alert(result);

      return null;
    },
    "rhymes": async function(app, text) {
      const noteUUID = app.context.noteUUID;
      const note = await app.notes.find(noteUUID);
      const noteContent = await note.content();

      const messages = [
        `You are a rhyming word generator. Respond only with a numbered list of the 10 best rhymes to replace the word "${ text }"`,
        `The suggested replacements will be inserted in place of the <replace>${ text }</replace> token in the following markdown document:\n~~~\n${ noteContent.replace(text, `<replace>${ text }</replace>`) }\n~~~`,
        `Respond with up to 10 rhyming words that can be inserted into the document, each of which is 3 or less words. Do not repeat the input content. Do not explain how you derived your answer. Do not explain why you chose your answer. Do not respond with the token itself.`
      ]
      const optionString = await this._callOpenAICompletion(app, "thesaurus", messages);
      const optionList = optionString?.split("\n")?.map(word => word.replace(/^[\d]+\.?[\s]?/g, ""))
      if (optionList?.length) {
        const selectedValue = await app.prompt(`Choose a replacement for "${ text }"`, {
          inputs: [ { type: "select", label: `${ optionList.length } synonym${ optionList.length === 1 ? "" : "s" } found`, options: optionList.map(option => ({ label: option.toLowerCase(), value: option.toLowerCase() })) } ]
        });
        if (selectedValue) return selectedValue;
      } else {
        app.alert("Got no rhymes");
      }
      return null;
    },
    "thesaurus": async function(app, text) {
      const noteUUID = app.context.noteUUID;
      const note = await app.notes.find(noteUUID);
      const noteContent = await note.content();

      const messages = [
        `You are a helpful thesaurus. Respond only with a numbered list of the 10 best suggestions to replace the word "${ text }"`,
        `The suggested replacements will be inserted in place of the <replace>${ text }</replace> token in the following markdown document:\n~~~\n${ noteContent.replace(text, `<replace>${ text }</replace>`) }\n~~~`,
        `Respond with up to 10 word alternatives that can be inserted into the document, each of which is 3 or less words. Do not repeat the input content. Do not explain how you derived your answer. Do not explain why you chose your answer. Do not respond with the token itself.`
      ]
      const optionString = await this._callOpenAICompletion(app, "thesaurus", messages);
      const optionList = optionString?.split("\n")?.map(word => word.replace(/^[\d]+\.?[\s]?/g, ""))
      if (optionList?.length) {
        const selectedValue = await app.prompt(`Choose a replacement for "${ text }"`, {
          inputs: [ { type: "select", label: `${ optionList.length } synonym${ optionList.length === 1 ? "" : "s" } found`, options: optionList.map(option => ({ label: option.toLowerCase(), value: option.toLowerCase() })) } ]
        });
        if (selectedValue) return selectedValue;
      } else {
        app.alert("No synonyms found");
      }
      return null;
    }
  },

  // --------------------------------------------------------------------------------------
  async _callOpenAICompletion(app, promptType, promptContent) {
    let messages = [];
    const systemPrompt = this._systemPrompts[promptType] || this.constants.defaultSystemPrompt;
    messages.push({ role: "system", content: systemPrompt });
    const userPrompt = this._userPrompts[promptType] ? this._userPrompts[promptType](promptContent) : promptContent;
    if (Array.isArray(userPrompt)) {
      userPrompt.forEach(content => {
        messages.push({ role: "user", content: this._truncate(content) });
      });
    } else {
      messages.push({ role: "user", content: this._truncate(userPrompt) });
    }
    try {
      const modelSetting = app.settings["OpenAI model (default is gpt-3.5-turbo)"];
      const model = modelSetting && modelSetting.trim().length ? modelSetting.trim() : "gpt-3.5-turbo";
      console.debug("Submitting messages", messages, "while using model", model);

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${ app.settings["API Key"].trim() }`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ model, messages, })
      });
      const result = await response.json();
      const { choices: [ { message: { content } } ] } = result;
      return content;
    } catch (error) {
      app.alert("Failed to call OpenAI: " + error);
      return null;
    }
  },

  // --------------------------------------------------------------------------------------
  // GPT-3.5 has a 4097 token limit, so very much approximating that limit with this number
  _truncate(text, limit = 15000) {
    return text.length > limit ? text.slice(0, limit) : text;
  },

  // --------------------------------------------------------------------------------------
  async _contextAwarePrompt(app, promptEm) {
    const noteUUID = app.context.noteUUID;
    const note = await app.notes.find(noteUUID);
    const noteContent = await note.content();

    const tokenLabel = `{${ this.constants.pluginName }: ${ promptEm }}`;
    const messages = this._parameterArrayFromPrompt(promptEm, tokenLabel, noteContent);
    if (messages) {
      return await this._callOpenAICompletion(app, promptEm, messages);
    } else {
      return null;
    }
  },

  // --------------------------------------------------------------------------------------
  async _insertImagePrompt(app, prompt) {
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${ app.settings["API Key"].trim() }`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        prompt,
        n: this.constants.generatedImageCount,
        size: "1024x1024",
      })
    });
    const result = await response.json();
    const { data } = result;
    if (data && data.length) {
      const urls = data.map(d => d.url);
      const imageList = urls.map(imageURL => `![image](${ imageURL })`).join("\n\n");
      return `To use these images: first ensure that you have a line break in front of them by pressing Enter in front of the image. Then delete and re-add the final parenthesis for the image and it will become an image. Sorry it's a PITA\n ${ imageList }`
    } else {
      return null;
    }
  },

  // --------------------------------------------------------------------------------------
  _parameterArrayFromPrompt(promptEm, tokenLabel, noteContent) {
    const specificityWords = (
      this.constants.strictReplacePromptEms.includes(promptEm)
        ? "only the exact word or words"
        : "text"
    );
    const tokenReplacePrompt = `Respond with ${ specificityWords } that could be used to replace the token <token> 
      in the following input markdown document, which begins and ends with triple tildes:`;
    const prompt = this.constants.tokenReplacePrompts[promptEm];
    const appendMessage = `The resulting text should be grammatically correct and make sense in context. 
      Do not explain how you derived your answer. Do not explain why you chose your answer. 
      Do not respond with the token itself.`;
    if (noteContent.includes(tokenLabel)) {
      const messages = [
        tokenReplacePrompt,
        prompt && prompt.length ? prompt : null,
        `~~~\n${ noteContent.replace(tokenLabel, "<token>") }\n~~~`,
        appendMessage
      ].filter(n => n);
      console.log("Composed messages for sending", messages);
      return messages;
    } else {
      app.alert("Couldn't find expected token in document")
      return null;
    }
  },
};
export default plugin;
