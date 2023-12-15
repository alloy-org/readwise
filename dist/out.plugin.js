(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // lib/dates.js
  function _yearFromDateString(dateString) {
    const dateObject = _dateObjectFromDateString(dateString);
    if (!dateObject)
      return null;
    return dateObject.getFullYear();
  }
  function _localeDateFromIsoDate(dateStringOrObject, dateFormat) {
    console.debug(`_localeDateFromIsoDate(app, ${dateStringOrObject}`);
    try {
      if (!dateStringOrObject)
        return "";
      const dateObject = new Date(dateStringOrObject);
      let result = dateObject.toLocaleDateString(dateFormat, { month: "long", day: "numeric", year: "numeric" });
      const recentDateCutoff = (/* @__PURE__ */ new Date()).setDate((/* @__PURE__ */ new Date()).getDate() - 3);
      if (dateObject > recentDateCutoff) {
        result += " " + dateObject.toLocaleTimeString(dateFormat, { hour: "numeric", minute: "2-digit", hour12: true });
      }
      return result;
    } catch (e) {
      console.error("There was an error parsing your date string", dateStringOrObject, e);
      return dateStringOrObject;
    }
  }
  function _dateObjectFromDateString(dateString) {
    console.log("_dateObjectFromDateString", dateString);
    if (!dateString)
      return null;
    let parseableString;
    try {
      parseableString = dateString.toLowerCase().replace(/\s?[ap]m/, "").replace(" at ", " ");
    } catch (err) {
      if (err.name === "TypeError") {
        throw new Error(`${err.message} (line 1293)`);
      }
    }
    const parsedDate = Date.parse(parseableString);
    if (parsedDate) {
      return new Date(parsedDate);
    } else {
      return null;
    }
  }
  async function _getLastUpdatedTimeFromNote(app, constants, noteHandle) {
    const content = await app.getNoteContent({ uuid: noteHandle.uuid });
    if (!content)
      return null;
    const lines = content.split("\n");
    if (lines.length === 0) {
      console.log("Found empty note parsing for date.");
      return null;
    }
    const dateLine = lines.find((line) => line.includes(constants.updateStringPreface));
    let result = null;
    if (dateLine) {
      let dateString;
      try {
        dateString = dateLine.replace(constants.updateStringPreface, "");
        if (dateString.includes("pm")) {
          const hourMatch = dateString.match(/at\s([\d]{1,2}):/);
          if (hourMatch) {
            dateString = dateString.replace(` ${hourMatch[1]}:`, ` ${parseInt(hourMatch[1]) + 12}:`);
          } else {
            console.error("Error parsing dateString");
          }
        }
      } catch (err) {
        if (err.name === "TypeError") {
          throw new Error(`${err.message} (line  1335)`);
        }
      }
      const result2 = _dateObjectFromDateString(dateString);
      if (!result2 || isNaN(result2.getTime())) {
        console.log("Could not ascertain date from", dateLine, "and dateString", dateString);
        return null;
      }
    } else {
      console.log("Couldn't find a line containing the update time for note", noteHandle.uuid);
    }
    if (result)
      console.debug(`Last updated detected: ${result.getTime()}`);
    return result;
  }

  // lib/markdown.js
  function _sectionFromHeadingText(headingText, { level = 1 } = {}) {
    return { heading: { text: headingText, level } };
  }
  function _markdownFromSections(app, sectionEntries, markdownFunction) {
    let markdown = "";
    for (let [key, value] of sectionEntries) {
      markdown += `## ${key}
`;
      markdown += markdownFunction(value);
    }
    return markdown;
  }
  function _markdownFromHighlights(hls, dateFormat) {
    let markdownLines = [];
    for (let hl of hls) {
      let result = "";
      result += `> ### ${hl.text}

`;
      if (hl.note)
        result += `**Note**: ${hl.note}
`;
      if (hl.color)
        result += `**Highlight color**: ${hl.color}
`;
      result += `**Highlighted at**: ${_localeDateFromIsoDate(hl.highlighted_at, dateFormat)} (#H${hl.id})
`;
      markdownLines.push(result);
    }
    return markdownLines.join("\n\n");
  }
  function _markdownFromTable(items) {
    let headers = Object.keys(items[0]);
    let markdown = "";
    markdown += _tablePreambleFromHeaders(headers);
    for (let item of items) {
      markdown += _markdownFromTableRow(headers, item);
    }
    markdown += "\n";
    return markdown;
  }
  function _tablePreambleFromHeaders(headers) {
    let markdown = "";
    markdown += `| ${headers.map((item) => `**${item}**`).join(" | ")} |
`;
    markdown += `| ${headers.map(() => "---").join(" | ")} |
`;
    return markdown;
  }
  function _markdownFromTableRow(headers, item) {
    let row;
    try {
      row = headers.map((header) => item[header].replace(/(?<!!\[\\)\|/g, ",") || "");
    } catch (err) {
      if (err.name === "TypeError") {
        throw new Error(`${err.message} (line 836)`);
      }
    }
    let markdown = `| ${row.join(" | ")} |
`;
    return markdown;
  }
  async function _sectionsFromMarkdown(noteContent, headingLabel, entriesFunction) {
    console.debug(`_sectionsFromMarkdown(noteHandle, ${headingLabel}, entriesFunction)`);
    let mainSectionContent = _sectionContent(noteContent, headingLabel);
    let sections = _getHeadingsFromMarkdown(mainSectionContent);
    let result = [];
    for (let section of sections) {
      let yearMarkdownContent = _sectionContent(mainSectionContent, section);
      let entries = entriesFunction(yearMarkdownContent);
      if (!entries)
        continue;
      result = result.concat(entries);
    }
    return result;
  }
  function _tableFromMarkdown(content) {
    console.debug(`_tableFromMarkdown(${content})`);
    let tableRegex = /^\s*\|(\s*\*\*[^|]+\*\*\s*\|)+$\n(\s*\|(.*\|)+$)+/gm;
    let tableMatch = content.match(tableRegex);
    if (!tableMatch) {
      console.error(`No table detected in the dashboard library`);
      throw new Error(`No table detected in the dashboard library`);
    }
    let lines = tableMatch[0].split("\n");
    if (lines.length < 2)
      return null;
    lines = lines.filter((row) => row.trim() !== "" && !row.trim().match(/^\s*\|([-\s]+\|\s*)+$/));
    if (!lines[0]) {
      console.error(`Dashboard has no meaningful rows: ${lines.join("\n")}`);
      throw new Error(`Dashboard has no meaningful rows: ${lines.join("\n")}`);
    }
    let headers;
    try {
      headers = lines[0].split("|").slice(1, -1).map((header) => header.trim().replace(new RegExp("\\*", "g"), ""));
    } catch (err) {
      if (err.name === "TypeError") {
        throw new Error(`${err.message} (line 887)`);
      }
    }
    const table = lines.slice(1).map((row) => {
      const cells = row.split(/(?<!\\)\|/).slice(1, -1).map((cell) => cell.trim());
      const rowObj = {};
      headers.forEach((header, i) => {
        if (cells[i] === "") {
          console.error(`Couldn't find a book property in the table.
Analyzing row: ${row}`);
          throw new Error(`Couldn't find a book property in the table.
Analyzing row: ${row}`);
        }
        if (cells[i] === void 0) {
          cells.push(`[No ${header}]`);
        }
        rowObj[header] = cells[i] || null;
      });
      return rowObj;
    });
    return table;
  }
  function _getHeadingsFromMarkdown(content) {
    const headingMatches = Array.from(content.matchAll(/^#+\s*([^\n]+)/gm));
    try {
      return headingMatches.map((match) => ({
        heading: {
          anchor: match[1].replace(/\s/g, "_"),
          level: match[0].match(/^#+/)[0].length,
          text: match[1]
        }
      }));
    } catch (err) {
      if (err.name === "TypeError") {
        throw new Error(`${err.message} (line 923)`);
      }
    }
  }
  function _mdSectionFromObject(section) {
    return `${"#".repeat(section.heading.level)} ${section.heading.text}
`;
  }
  function _tableStrippedPreambleFromTable(tableContent) {
    try {
      [
        /^([|\s*]+(Cover|Book Title|Author|Category|Source|Highlights|Updated|Other Details)){1,10}[|\s*]*(?:[\r\n]+|$)/gm,
        /^[|\-\s]+(?:[\r\n]+|$)/gm
        // Remove top two rows that markdown tables export as of June 2023
      ].forEach((removeString) => {
        tableContent = tableContent.replace(removeString, "").trim();
        tableContent = tableContent.replace(/^#+.*/g, "");
      });
    } catch (err) {
      if (err.name === "TypeError") {
        throw new Error(`${err.message} (line 949)`);
      }
    }
    return tableContent;
  }

  // lib/amplenote_rw.js
  function _sectionContent(noteContent, headingTextOrSectionObject) {
    console.debug(`_sectionContent()`);
    let sectionHeadingText;
    if (typeof headingTextOrSectionObject === "string") {
      sectionHeadingText = headingTextOrSectionObject;
    } else {
      sectionHeadingText = headingTextOrSectionObject.heading.text;
    }
    try {
      sectionHeadingText = sectionHeadingText.replace(/^#+\s*/, "");
    } catch (err) {
      if (err.name === "TypeError") {
        throw new Error(`${err.message} (line 1054)`);
      }
    }
    const { startIndex, endIndex } = _sectionRange(noteContent, sectionHeadingText);
    return noteContent.slice(startIndex, endIndex);
  }
  async function _replaceContent(noteContents, note, sectionHeadingText, newContent, { level = 1 } = {}) {
    const replaceTarget = _sectionFromHeadingText(sectionHeadingText, { level });
    let throughLevel = replaceTarget.heading?.level;
    if (!throughLevel)
      throughLevel = sectionHeadingText.match(/^#*/)[0].length;
    if (!throughLevel)
      throughLevel = 1;
    const bodyContent = noteContents[note.uuid];
    const { startIndex, endIndex } = _sectionRange(bodyContent, sectionHeadingText);
    if (startIndex) {
      const revisedContent = `${bodyContent.slice(0, startIndex)}
${newContent}${bodyContent.slice(endIndex)}`;
      noteContents[note.uuid] = revisedContent;
    } else {
      throw new Error(`Could not find section ${sectionHeadingText} in note ${note.name}`);
    }
  }
  function _sectionRange(bodyContent, sectionHeadingText) {
    console.debug(`_sectionRange`);
    const sectionRegex = /^#+\s*([^#\n\r]+)/gm;
    const indexes = Array.from(bodyContent.matchAll(sectionRegex));
    const sectionMatch = indexes.find((m) => m[1].trim() === sectionHeadingText.trim());
    if (!sectionMatch) {
      console.error("Could not find section", sectionHeadingText, "that was looked up. This might be expected");
      return { startIndex: null, endIndex: null };
    } else {
      const level = sectionMatch[0].match(/^#+/)[0].length;
      const nextMatch = indexes.find((m) => m.index > sectionMatch.index && m[0].match(/^#+/)[0].length <= level);
      const endIndex = nextMatch ? nextMatch.index : bodyContent.length;
      return { startIndex: sectionMatch.index + sectionMatch[0].length + 1, endIndex };
    }
  }
  async function _insertContent(noteContents, note, newContent, { atEnd = false } = {}) {
    console.log(JSON.stringify(note));
    const oldContent = noteContents[note.uuid] || "";
    if (atEnd) {
      noteContents[note.uuid] = `${oldContent.trim()}
${newContent}`;
    } else {
      noteContents[note.uuid] = `${newContent.trim()}
${oldContent}`;
    }
  }
  async function _sections(noteContents, note, { minIndent = null } = {}) {
    console.debug(`_sections()`);
    let sections;
    const content = noteContents[note.uuid];
    sections = _getHeadingsFromMarkdown(content);
    if (Number.isInteger(minIndent)) {
      sections = sections.filter((section) => section.heading?.level >= minIndent && section.heading.text.trim().length) || [];
      return sections;
    } else {
      return sections;
    }
  }
  async function _noteContent(noteContents, note) {
    if (typeof noteContents[note.uuid] === "undefined") {
      noteContents[note.uuid] = await note.content();
    }
    return noteContents[note.uuid];
  }
  async function _flushLocalNotes(app, noteContents) {
    console.log("_flushLocalNotes(app)");
    for (const uuid in noteContents) {
      console.log(`Flushing ${uuid}...`);
      const note = await app.notes.find({ uuid });
      let content = noteContents[uuid];
      if (!note.uuid.includes("local-")) {
        noteContents[note.uuid] = content;
      }
      let newContent = "";
      let sections = await _sections(noteContents, note);
      console.debug(`Inserting sections ${sections.toString()}...`);
      for (const section of sections) {
        newContent = `${newContent}${_mdSectionFromObject(section)}`;
      }
      await app.replaceNoteContent({ uuid: note.uuid }, newContent);
      sections = _findLeafNodes(sections);
      for (const section of sections) {
        console.debug(`Inserting individual section content for ${section.heading.text}...`);
        let newSectionContent = _sectionContent(content, section);
        await app.replaceNoteContent({ uuid: note.uuid }, newSectionContent, { section });
      }
      delete noteContents[uuid];
      delete noteContents[note.uuid];
    }
  }
  function _findLeafNodes(depths) {
    let leafNodes = [];
    for (let i = 0; i < depths.length - 1; i++) {
      if (depths[i + 1].heading.level <= depths[i].heading.level) {
        leafNodes.push(depths[i]);
      }
    }
    if (depths.length > 0 && (leafNodes.length === 0 || leafNodes[leafNodes.length - 1].heading.level !== depths.length - 1)) {
      leafNodes.push(depths[depths.length - 1]);
    }
    return leafNodes;
  }
  function _textToTagName(text) {
    console.log("_textToTagName", text);
    if (!text)
      return null;
    try {
      return text.toLowerCase().trim().replace(/[^a-z0-9\/]/g, "-");
    } catch (err) {
      if (err.name === "TypeError") {
        throw new Error(`${err.message} (line 1234)`);
      }
    }
  }

  // lib/data_structures.js
  function _groupByValue(toGroup, groupFunction) {
    let result = {};
    for (let item of toGroup) {
      let key = groupFunction(item);
      if (key in result) {
        result[key].push(item);
      } else {
        result[key] = [item];
      }
    }
    return result;
  }
  function _distributeIntoSmallGroups(source, groupSize, trimSize, trimFunction, dateFormat) {
    let result = {};
    for (let group of Object.keys(source)) {
      let groupRows = [...source[group]];
      let chunks = [];
      while (groupRows.length) {
        let toPush = groupRows.splice(0, groupSize);
        if (trimFunction) {
          toPush = trimFunction(trimSize, toPush, dateFormat);
        }
        chunks.push(toPush);
      }
      chunks.forEach((chunk, index) => {
        result[`${group}${index > 0 ? " (part " + (index + 1) + ")" : ""}`] = chunk;
      });
    }
    return result;
  }
  function _trimHighlights(trimSize, toPush, dateFormat) {
    let groupMarkdown = _markdownFromHighlights(toPush, dateFormat);
    if (groupMarkdown.length < trimSize)
      return toPush;
    console.log("Trimming highlights for length...");
    const itemTextLimit = trimSize / toPush.length - "> ### \n\n".length - "**Highlighted at**: \n".length - // Subtract the characters that we insert next to the highlight text itself
    " (Trimmed for length)".length - // Subtract the text we add to explain a highlight was trimmed
    30;
    for (const item of toPush) {
      if (item.text.length > itemTextLimit) {
        item.note = null;
        item.color = null;
        item.text = item.text.slice(0, itemTextLimit) + " (Trimmed for length)";
      }
    }
    return toPush;
  }

  // lib/dashboard.js
  async function _writeDashboard(app, noteContents, dashboard, dashboardNote, dashboardConstants) {
    console.debug(`_writeDashboard()`);
    for (let [key, value] of Object.entries(dashboard)) {
      dashboard[key] = value.sort(_sortBooks);
    }
    dashboard = _distributeIntoSmallGroups(dashboard, dashboardConstants.maxTableBooksPerSection);
    let entries = Object.entries(dashboard);
    entries.sort((a, b) => b[0].localeCompare(a[0]));
    let dashboardMarkdown = _markdownFromSections(app, entries, _markdownFromTable.bind(this));
    await _replaceContent(noteContents, dashboardNote, dashboardConstants.dashboardBookListTitle, dashboardMarkdown);
  }
  async function _ensureBookInDashboardNoteTable(app, dashboard, bookObject) {
    console.log(`_ensureBookInDashboardNoteTable(app, ${bookObject})`);
    for (let year2 of Object.keys(dashboard)) {
      let entries = dashboard[year2];
      for (let e of entries) {
        console.debug(e["Book Title"]);
      }
    }
    _removeBookFromDashboard(dashboard, bookObject);
    let year = _sectionNameFromLastHighlight(bookObject.Updated);
    if (year in dashboard) {
      dashboard[year].push(bookObject);
      dashboard[year] = dashboard[year].sort(_sortBooks);
    } else {
      dashboard[year] = [bookObject];
    }
  }
  function _sectionNameFromLastHighlight(lastHighlightDateString) {
    let year = "";
    if (lastHighlightDateString && _dateObjectFromDateString(lastHighlightDateString)) {
      year = _dateObjectFromDateString(lastHighlightDateString).getFullYear();
    } else {
      year = "(No highlights yet)";
    }
    return year;
  }
  function _removeBookFromDashboard(dashboard, bookObject) {
    for (let year of Object.keys(dashboard)) {
      const index = dashboard[year].findIndex((book) => bookObject["Book Title"] === book["Book Title"]);
      if (index !== -1) {
        dashboard[year].splice(index, 1);
        break;
      }
    }
  }
  async function _updateDashboardDetails(app, dashboard, dashDetailsFieldNames, dateFormat, details, { tableRowCount = null, bookCount = null } = {}) {
    console.log(`_updateDashboardDetails(app, ${dashboard}, ${details}, ${tableRowCount}, ${bookCount} )`);
    const lastUpdatedAt = _boundaryBookUpdatedAtFromDashboard(dashboard, true);
    const earliestUpdatedAt = _boundaryBookUpdatedAtFromDashboard(dashboard, false);
    details[dashDetailsFieldNames.lastSyncedAt] = _localeDateFromIsoDate(/* @__PURE__ */ new Date(), dateFormat);
    details[dashDetailsFieldNames.firstUpdated] = _localeDateFromIsoDate(earliestUpdatedAt, dateFormat);
    details[dashDetailsFieldNames.lastUpdated] = _localeDateFromIsoDate(lastUpdatedAt, dateFormat);
    details[dashDetailsFieldNames.booksImported] = tableRowCount;
    let booksReported = details[dashDetailsFieldNames.booksReported];
    details[dashDetailsFieldNames.booksReported] = bookCount ? bookCount : booksReported;
  }
  function _boundaryBookUpdatedAtFromDashboard(dashboard, findLatest) {
    let result;
    for (let group in dashboard) {
      for (let item of dashboard[group]) {
        let itemDate = _dateObjectFromDateString(item.Updated);
        if (!itemDate || isNaN(itemDate.getTime())) {
        } else if (!result || findLatest && itemDate > result || !findLatest && itemDate < result) {
          result = itemDate;
        }
      }
    }
    console.debug("Found lastUpdatedAt", result, "aka", _localeDateFromIsoDate(result, "en-us"), "the", findLatest ? "latest" : "earliest", "record");
    return result;
  }
  function _loadDetails(text) {
    let lines = text.split("\n");
    let details = {};
    lines.forEach((line) => {
      if (!line.includes(":"))
        return;
      let [key, value] = line.slice(2).split(": ");
      let intValue = parseInt(value, 10);
      details[key] = isNaN(intValue) ? value : intValue;
    });
    return details;
  }
  function _writeDetails(details) {
    let text = "";
    for (let key of Object.keys(details)) {
      text += `- ${key}: ${details[key]}
`;
    }
    return text;
  }
  async function _migrateBooksToSections(app, noteContents, dashboardNote, dashboardConstants) {
    console.log(`_migrateBooksToSections`);
    const doMigrate = async () => {
      const dashboardNoteContent = await _noteContent(noteContents, dashboardNote);
      let dashboardBookListMarkdown = _sectionContent(dashboardNoteContent, dashboardConstants.dashboardBookListTitle);
      let bookListRows = [];
      if (dashboardBookListMarkdown) {
        bookListRows = Array.from(dashboardBookListMarkdown.matchAll(/^(\|\s*![^\n]+)\n/gm));
        if (bookListRows.length) {
          console.debug("Found", bookListRows.length, "books to potentially migrate");
        } else {
          console.debug("No existing books found to migrate");
          return;
        }
      } else {
        console.debug("No dashboard book list found to migrate");
        return;
      }
      const subSections = Array.from(dashboardBookListMarkdown.matchAll(/^##\s+([\w\s]+)/gm)).map((match) => match[1].trim()).filter((w) => w);
      if (subSections.length && !subSections.find((heading) => heading === dashboardConstants.unsortedSectionTitle)) {
        console.log("Book list is already in sections, no migration necessary");
        return;
      } else if (!dashboardBookListMarkdown.includes(dashboardConstants.unsortedSectionTitle)) {
        const unsortedSectionContent = `## ${dashboardConstants.unsortedSectionTitle}
${dashboardBookListMarkdown}`;
        await _replaceContent(noteContents, dashboardNote, dashboardConstants.dashboardBookListTitle, unsortedSectionContent);
        console.log("Your Readwise library will be updated to split highlights into sections for faster future updates. This might take a few minutes if you have a large library.");
      }
      const dashboard = {};
      const bookObjectList = _tableFromMarkdown(dashboardBookListMarkdown);
      const processed = [];
      for (const bookObject of bookObjectList) {
        console.debug("Processing", processed.length, "of", bookObjectList.length, "books");
        await _ensureBookInDashboardNoteTable(app, dashboard, bookObject);
      }
      await _writeDashboard(app, noteContents, dashboard, dashboardNote, dashboardConstants);
      const unsortedContent = _sectionContent(await _noteContent(noteContents, dashboardNote), dashboardConstants.unsortedSectionTitle);
      const unsortedWithoutTable = _tableStrippedPreambleFromTable(unsortedContent);
      if (unsortedContent.length && (unsortedWithoutTable?.trim()?.length || 0) === 0) {
        await _replaceContent(noteContents, dashboardNote, dashboardConstants.unsortedSectionTitle, "");
        dashboardBookListMarkdown = _sectionContent(await _noteContent(noteContents, dashboardNote), dashboardConstants.dashboardBookListTitle);
        try {
          dashboardBookListMarkdown = dashboardBookListMarkdown.replace(new RegExp(`#+\\s${dashboardConstants.unsortedSectionTitle}[\\r\\n]*`), "");
        } catch (err) {
          if (err.name === "TypeError") {
            throw new Error(`${err.message} (line 486)`);
          }
        }
        await _replaceContent(noteContents, dashboardNote, dashboardConstants.dashboardBookListTitle, dashboardBookListMarkdown.trim());
        console.log("Successfully migrated books to yearly sections");
      }
      await _flushLocalNotes(app, noteContents);
    };
    await doMigrate();
  }
  function _sortBooks(a, b) {
    if (!a.Updated) {
      if (a["Book Title"] < b["Book Title"])
        return -1;
      else
        return 1;
    } else {
      return new Date(b.Updated) - new Date(a.Updated);
    }
  }

  // lib/readwise.js
  var readwise_exports = {};
  __export(readwise_exports, {
    _ensureRequestDelta: () => _ensureRequestDelta,
    _getReadwiseBookCount: () => _getReadwiseBookCount,
    _readwiseFetchBooks: () => _readwiseFetchBooks,
    _readwiseGetAllHighlightsForBook: () => _readwiseGetAllHighlightsForBook,
    _readwiseMakeRequest: () => _readwiseMakeRequest,
    _readwisePaginateExportRequest: () => _readwisePaginateExportRequest,
    _readwisePaginateRequest: () => _readwisePaginateRequest,
    _testLongReadwiseFetchBooks: () => _testLongReadwiseFetchBooks
  });
  var _requestsCount = 0;
  var _lastRequestTime = 0;
  async function _getReadwiseBookCount(app, constants) {
    const bookIndexResponse = await _readwiseMakeRequest(app, constants, `${constants.readwiseBookIndexURL}?page_size=1`);
    if (bookIndexResponse?.count) {
      return bookIndexResponse.count;
    } else {
      console.log("Did not received a Book index response from Readwise. Not updating Dashboard content");
      return null;
    }
  }
  async function* _testLongReadwiseFetchBooks(app, { bookIdFilter = null, categoryFilter = null, dateFilter = null } = {}) {
    let hls = [...Array(10).keys()];
    hls = hls.map((item) => ({
      "id": item,
      "text": "a".repeat(1e4),
      "location": 1,
      "location_type": "order",
      "note": null,
      "color": "yellow",
      "highlighted_at": "2022-09-13T16:41:53.186Z",
      "created_at": "2022-09-13T16:41:53.186Z",
      "updated_at": "2022-09-14T18:50:30.564Z",
      "external_id": "6320b2bd7fbcdd7b0c000b3e",
      "end_location": null,
      "url": null,
      "book_id": 123,
      "tags": [],
      "is_favorite": false,
      "is_discard": false,
      "readwise_url": "https://readwise.io/open/456"
    }));
    yield {
      "user_book_id": 123,
      "title": "Some title",
      "author": "Some author",
      "readable_title": "Some title",
      "source": "raindrop",
      "cover_image_url": "https://cover.com/image.png",
      "unique_url": "",
      "book_tags": [],
      "category": "articles",
      "document_note": "",
      "readwise_url": "https://readwise.io/bookreview/123",
      "source_url": "",
      "asin": null,
      "highlights": hls
    };
  }
  async function* _readwiseFetchBooks(app, constants, { bookIdFilter = null, categoryFilter = null, dateFilter = null } = {}) {
    const url = new URL(`${constants.readwiseExportURL}`);
    if (bookIdFilter)
      url.searchParams.append("ids", bookIdFilter);
    if (dateFilter && !categoryFilter)
      url.searchParams.append("updatedAfter", dateFilter);
    for await (const item of _readwisePaginateExportRequest(app, constants, url)) {
      if (categoryFilter && item.category !== categoryFilter)
        continue;
      yield item;
    }
  }
  async function* _readwisePaginateExportRequest(app, constants, url) {
    let nextPage = false;
    while (true) {
      if (nextPage)
        url.searchParams.set("pageCursor", nextPage);
      const data = await _readwiseMakeRequest(app, constants, url);
      if (data) {
        for (const item of data.results) {
          item.id = item.user_book_id;
          item.num_highlights = item.highlights.length;
          let hls = item.highlights;
          hls = hls.sort((a, b) => {
            if (a.highlighted_at === void 0)
              return 1;
            if (b.highlighted_at === void 0)
              return -1;
            return new Date(b.highlighted_at) - new Date(a.highlighted_at);
          });
          item.highlights = hls;
          item.last_highlight_at = null;
          if (hls[0])
            item.last_highlight_at = hls[0].highlighted_at;
          yield item;
        }
        nextPage = data.nextPageCursor;
        if (!nextPage)
          break;
      } else {
        console.error("Breaking from pagination loop due to no response from request", url);
        break;
      }
    }
  }
  async function* _readwiseGetAllHighlightsForBook(app, bookId, updatedAfter) {
    console.log(`_readwiseGetAllHighlightsForBook(app, ${bookId}, ${updatedAfter})`);
    const url = new URL(`${this.constants.readwiseHighlightsIndexURL}/`);
    const params = new URLSearchParams();
    params.append("book_id", bookId);
    if (updatedAfter) {
      params.append("updated__gt", updatedAfter.toISOString().slice(0, -1) + "Z");
    }
    url.search = params;
    yield* _readwisePaginateRequest(app, url);
  }
  async function* _readwisePaginateRequest(app, constants, baseUrl) {
    let currentPage = 1;
    let hasNextPage = true;
    while (hasNextPage) {
      baseUrl.searchParams.append("page", currentPage);
      baseUrl.searchParams.append("page_size", constants.readwisePageSize);
      const data = await _readwiseMakeRequest(app, constants, baseUrl);
      if (data) {
        for (const item of data.results) {
          yield item;
        }
        hasNextPage = data.next !== null;
      } else {
        console.error("Breaking from pagination loop due to no response from request", baseUrl);
        break;
      }
      currentPage++;
    }
  }
  async function _readwiseMakeRequest(app, constants, url) {
    console.log(`_readwiseMakeRequest(app, ${url.toString()})`);
    const readwiseAPIKey = app.settings["Readwise Access Token"];
    if (!readwiseAPIKey || readwiseAPIKey.trim() === "") {
      throw new Error("Readwise API key is empty. Please provide a valid API key.");
    }
    const headers = new Headers({ "Authorization": `Token ${readwiseAPIKey}`, "Content-Type": "application/json" });
    await _ensureRequestDelta(app, constants);
    const proxyUrl = `https://amplenote-plugins-cors-anywhere.onrender.com/${url.toString()}`;
    const tryFetch = async () => {
      const response = await fetch(proxyUrl, { method: "GET", headers });
      if (!response.ok) {
        console.error(`HTTP error. Status: ${response.status}`);
        return null;
      } else {
        return response.json();
      }
    };
    try {
      let result = await tryFetch();
      if (result) {
        return result;
      } else {
        console.error("Null result trying fetch. Sleeping before final retry");
        await new Promise((resolve) => setTimeout(resolve, constants.sleepSecondsAfterRequestFail * 1e3));
        return await tryFetch();
      }
    } catch (e) {
      console.trace();
      console.error("Handling", e, "stack", e.stack);
      app.alert("Error making request to Readwise", e);
      return null;
    }
  }
  async function _ensureRequestDelta(app, constants) {
    const currentTime = /* @__PURE__ */ new Date();
    if (_lastRequestTime) {
      const timeDifference = (currentTime - _lastRequestTime) / 6e4;
      if (timeDifference >= 1) {
        _requestsCount = 0;
      }
      if (_requestsCount >= constants.rateLimit) {
        const waitTime = 6e4 - timeDifference * 6e4;
        const alertMessage = `Waiting for ${Math.floor(waitTime / 1e3)} seconds to satisfy Readwise API limit...

You can wait here, or click "DONE" to dismiss, and we will update notes in the background as you work. \u23F3

Working concurrently while notes are being changed could lead to merge issues, so we recommend minimizing note changes while a sync is underway.`;
        const response = await app.alert(alertMessage, { actions: [{ label: "Cancel sync", icon: "close" }] });
        if (response === 0) {
          console.debug("User cancelled sync");
        } else {
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          _requestsCount = 0;
        }
      }
    }
    _lastRequestTime = currentTime;
    _requestsCount++;
  }

  // lib/books.js
  async function _ensureBookNote(app, constants, readwiseBook) {
    const baseTag = app.settings[constants.settingTagName] || constants.defaultBaseTag;
    console.debug(`_ensureBookNote(${readwiseBook.title})`, baseTag);
    const readwiseNotes = await app.filterNotes({ tag: baseTag });
    const bookRegex = new RegExp(`ID\\s?#${readwiseBook.id}`);
    const searchResults = readwiseNotes.filter((item) => bookRegex.test(item.name));
    let bookNote = null;
    if (searchResults.length === 0) {
      const noteTitle = _noteTitleFromBook(readwiseBook);
      const bookNoteTags = [`${baseTag}/${_textToTagName(readwiseBook.category)}`];
      if (app.settings[constants.settingAuthorTag] === "true") {
        const candidateAuthorTag = _textToTagName(readwiseBook.author);
        const authorTag = candidateAuthorTag && candidateAuthorTag.split("-").slice(0, 3).join("-");
        if (authorTag)
          bookNoteTags.push(`${baseTag}/${authorTag}`);
      }
      bookNote = await app.notes.create(noteTitle, bookNoteTags);
    } else {
      const newNoteUUID = searchResults[0].uuid;
      bookNote = await app.notes.find(newNoteUUID);
    }
    return bookNote;
  }
  function _noteTitleFromBook(book) {
    return `${book.title} by ${book.author} Highlights (ID #${book.id})`;
  }
  function _bookNotePrefaceContentFromReadwiseBook(app, constants, dateFormat, book, bookNoteUUID) {
    console.log("_bookNotePrefaceContentFromReadwiseBook", JSON.stringify(book));
    let sourceContent = book.source_url ? `[${book.source}](${book.source_url})` : book.source;
    let asinContent = "";
    if (book.asin) {
      if (!book.source.toLowerCase())
        console.error("Book ", book.title, "does not have a source?");
      if (book.source?.toLowerCase()?.includes("kindle")) {
        const kindleUrl = `kindle://book?action=open&asin=${book.asin}`;
        sourceContent = `[${book.source}](${kindleUrl})`;
        asinContent = `ASIN: [${book.asin}](${kindleUrl})`;
      } else {
        asinContent = `ASIN: [${book.asin}](https://www.amazon.com/dp/${book.asin})`;
      }
    }
    const baseTag = app.settings[constants.settingTagName] || constants.defaultBaseTag;
    return `![Book cover](${book.cover_image_url})
- **${book.title}**
- Book Author: [${book.author}](/notes/${bookNoteUUID}?tag=${baseTag}/${_textToTagName(book.author)})
- Category: ${book.category}
- Source: ${sourceContent}
` + (asinContent ? `- ${asinContent}
` : "") + `- Highlight count: ${book.num_highlights}
- Last highlight: ${_localeDateFromIsoDate(book.last_highlight_at, dateFormat)}
- [View all highlights on Readwise](https://readwise.io/bookreview/${book.id})


`;
  }
  function _bookObjectFromReadwiseBook(readwiseBook, bookNoteUUID, dateFormat) {
    console.debug(`_bookObjectFromReadwiseBook(${readwiseBook})`);
    let sourceContent = readwiseBook.source;
    if (sourceContent === "kindle" && readwiseBook.asin) {
      sourceContent = `[${readwiseBook.source}](kindle://book?action=open&asin=${readwiseBook.asin})`;
    } else if (readwiseBook.source_url) {
      sourceContent = `[${readwiseBook.source}](${readwiseBook.source_url})`;
    }
    return {
      "Cover": `${readwiseBook.cover_image_url ? `![\\|200](${readwiseBook.cover_image_url})` : "[No cover image]"}`,
      "Book Title": `[${readwiseBook.title}](https://www.amplenote.com/notes/${bookNoteUUID})`,
      "Author": readwiseBook.author || "[No author]",
      "Category": readwiseBook.category || "[No category]",
      "Source": sourceContent || "[No source]",
      "Highlights": `[${readwiseBook.num_highlights} highlight${readwiseBook.num_highlights === 1 ? "" : "s"}](https://www.amplenote.com/notes/${bookNoteUUID}#Highlights})`,
      "Updated": `${readwiseBook.last_highlight_at ? _localeDateFromIsoDate(readwiseBook.last_highlight_at, dateFormat) : "No highlights"}`,
      // `/bookreview/[\d]+` is used as a regex to grab Readwise book ID from row
      "Other Details": `[Readwise link](https://readwise.io/bookreview/${readwiseBook.id})`
    };
  }
  function _loadHighlights(markdown) {
    let result = [];
    for (let hl of markdown.split("> ###")) {
      let hlObject = {};
      let lines = hl.split("\n");
      hlObject.text = lines[0];
      for (let i = 1; i < lines.length; i++) {
        if (lines[i].startsWith("**Location**:")) {
          hlObject.location = lines[i].substring(14);
        } else if (lines[i].startsWith("**Highlighted at**:")) {
          hlObject.highlighted_at = lines[i].substring(19);
        } else if (lines[i].startsWith("**Note**:")) {
          hlObject.note = lines[i].substring(9);
        } else if (lines[i].startsWith("**Highlight color**:")) {
          hlObject.color = lines[i].substring(20);
        }
      }
      result.push(hlObject);
    }
    return result;
  }
  async function _bookHighlightsContentFromReadwiseBook(app, readwiseBook, existingHighlights, lastUpdatedAt) {
    console.log(`Getting all highlights for ${readwiseBook.title}. Last updated at: ${lastUpdatedAt}. Existing highlights length: ${existingHighlights?.length}`);
    const newHighlightsList = readwiseBook.highlights;
    let result = [];
    if (newHighlightsList.length) {
      let existingHighlightsContent = existingHighlights.join("\n");
      if (/\(#H[\d]+\)/.test(existingHighlightsContent)) {
        result = newHighlightsList.concat(existingHighlights);
      } else {
        result = newHighlightsList;
      }
    } else {
      result = existingHighlights;
    }
    return result;
  }

  // lib/plugin.js
  var plugin = {
    // TODO: handle abort execution
    // TODO: add conditions to plugin actions
    constants: {
      dashboardLibraryDetailsHeading: "Library Details",
      dashDetails: {
        lastSyncedAt: "Last synced at",
        firstUpdated: "Oldest update synced in",
        lastUpdated: "Next sync for content updated after",
        booksImported: "Readwise books imported into table",
        booksReported: "Book count reported by Readwise"
      },
      dashboardConstants: {
        maxTableBooksPerSection: 20,
        defaultDashboardNoteTitle: "Readwise Library Dashboard",
        unsortedSectionTitle: "Books pending sort",
        dashboardBookListTitle: "Readwise Book List"
      },
      readwiseConstants: {
        rateLimit: 20,
        // Max requests per minute (20 is Readwise limit for Books and Highlights APIs)
        readwiseBookDetailURL: (bookId) => `https://readwise.io/api/v2/books/${bookId}`,
        readwiseBookIndexURL: "https://readwise.io/api/v2/books",
        readwiseExportURL: "https://readwise.io/api/v2/export",
        readwiseHighlightsIndexURL: "https://readwise.io/api/v2/highlights",
        readwisePageSize: 1e3,
        // Highlights and Books both claim they can support page sizes up to 1000 so we'll take them up on that to reduce number of requests we need to make
        sleepSecondsAfterRequestFail: 10
      },
      bookConstants: {
        defaultBaseTag: "library",
        defaultHighlightSort: "newest",
        maxBookHighlightsPerSection: 10,
        settingAuthorTag: 'Save authors as tags ("true" or "false". Default: false)',
        settingSortOrderName: 'Highlight sort order ("newest" or "oldest". Default: newest)',
        settingTagName: "Base tag for Readwise notes (Default: library)",
        updateStringPreface: "- Highlights updated at: ",
        maxReplaceContentLength: 1e5
        // Empirically derived
      },
      maxBookLimitInMemory: 20,
      maxHighlightLimit: 5e3,
      maxBookLimit: 500,
      settingDateFormat: "Date format (default: en-US)",
      settingDiscardedName: 'Import discarded highlights ("true" or "false". Default: false)'
    },
    readwiseModule: void 0,
    appOption: {
      /*******************************************************************************************
       * Fetches all books found in Readwise. Creates a note per book.
       */
      "Sync all": async function(app) {
        this._initialize(app);
        this._useLocalNoteContents = true;
        await this._syncAll(app);
      },
      /*******************************************************************************************
       * Fetches all items of a certain category. Creates a note per item.
       */
      "Sync only...": async function(app) {
        this._initialize(app);
        this._useLocalNoteContents = true;
        await this._syncOnly(app);
      }
    },
    noteOption: {
      /*******************************************************************************************
       * Syncs newer highlights for an individual book.
       * Fails if the note title doesn't match the required template.
       */
      "Sync this book": {
        run: async function(app, noteUUID) {
          this._initialize(app);
          this._useLocalNoteContents = true;
          await this._syncThisBook(app, noteUUID);
        },
        /*
         * Only show the option to sync a book if the note title has the expected format and tag applied
         */
        check: async function(app, noteUUID) {
          const noteObject = await app.findNote({ uuid: noteUUID });
          const noteTitle = noteObject.name;
          const bookTitleRegExp = new RegExp(".*(ID #[0-9]+)");
          if (!bookTitleRegExp.test(noteTitle))
            return false;
          for (const tag of noteObject.tags) {
            if (tag.startsWith(app.settings[this.constants.bookConstants.settingTagName] || this.constants.bookConstants.defaultBaseTag))
              return true;
          }
          return false;
        }
      }
    },
    /*******************************************************************************************/
    /* Main entry points
    /*******************************************************************************************/
    async _syncAll(app, categoryFilter) {
      console.log("Starting sync all", /* @__PURE__ */ new Date());
      try {
        const dashboardNoteTitle = app.settings[`Readwise dashboard note title (default: ${this.constants.dashboardConstants.defaultDashboardNoteTitle})`] || this.constants.dashboardConstants.defaultDashboardNoteTitle;
        if (this._abortExecution)
          app.alert("_abortExecution is true")[this._forceReprocess, this._dateFormat] = await app.prompt("Readwise sync options", {
            inputs: [
              {
                label: "Force reprocess of all book highlights?",
                type: "select",
                options: [
                  { value: "false", label: `No (uses "Last updated" dates to sync only new)` },
                  { value: "true", label: `Yes (slower, uses more quota)` }
                ]
              },
              {
                label: "Date format",
                type: "select",
                options: [
                  { value: "default", label: `Current default (${app.settings[this.constants.settingDateFormat] || "en-US"})` },
                  { value: "en-US", label: "en-US (English - United States)" },
                  { value: "en-GB", label: "en-GB (English - United Kingdom)" },
                  { value: "de-DE", label: "de-DE (German - Germany)" },
                  { value: "fr-FR", label: "fr-FR (French - France)" },
                  { value: "es-ES", label: "es-ES (Espanol - Spain)" },
                  { value: "it-IT", label: "it-IT (Italian - Italy)" },
                  { value: "ja-JP", label: "ja-JP (Japanese - Japan)" },
                  { value: "ko-KR", label: "ko-KR (Korean - Korea)" },
                  { value: "pt-PT", label: "pt-PT (Portuguese - Portugal)" },
                  { value: "pt-BR", label: "pt-BR (Portuguese - Basil)" },
                  { value: "zh-CN", label: "zh-CN (Chinese - China)" },
                  { value: "zh-TW", label: "zh-TW (Chinese - Taiwan)" }
                ]
              }
            ]
          });
        const baseTag = app.settings[this.constants.bookConstants.settingTagName] || this.constants.bookConstants.defaultBaseTag;
        let dashboardNote = await app.findNote({ name: dashboardNoteTitle, tag: baseTag });
        if (dashboardNote) {
          console.log("Found existing dashboard note", dashboardNote, "for", dashboardNoteTitle);
          dashboardNote = await app.notes.find(dashboardNote.uuid);
        } else {
          console.log("Creating dashboard note anew");
          dashboardNote = await app.notes.create(dashboardNoteTitle, [baseTag]);
        }
        if (app.context.noteUUID !== dashboardNote.uuid) {
          let origin;
          try {
            origin = window.location.origin.includes("localhost") ? "http://localhost:3000" : window.location.origin.replace("plugins", "www");
          } catch (err) {
            if (err.name === "TypeError") {
              throw new Error(`${err.message} (line (141)`);
            }
          }
          const navigateUrl = `${origin}/notes/${dashboardNote.uuid}`;
          await app.navigate(navigateUrl);
        }
        let bookCount = 0;
        await _migrateBooksToSections(app, this._noteContents, dashboardNote, this.constants.dashboardConstants);
        let dashboardNoteContents = await _noteContent(this._noteContents, dashboardNote);
        const details = _loadDetails(_sectionContent(dashboardNoteContents, this.constants.dashboardLibraryDetailsHeading));
        if (!dashboardNoteContents.includes(this.constants.dashboardLibraryDetailsHeading)) {
          await _insertContent(this._noteContents, dashboardNote, "# " + this.constants.dashboardLibraryDetailsHeading + "\n");
        }
        if (!dashboardNoteContents.includes(this.constants.dashboardConstants.dashboardBookListTitle)) {
          await _insertContent(this._noteContents, dashboardNote, `# ${this.constants.dashboardConstants.dashboardBookListTitle}
`, { atEnd: true });
        }
        const updateThrough = details.lastUpdated;
        const dateFormat = this._dateFormat || app && app.settings[this.constants.settingDateFormat] || "en-US";
        let dateFilter = null;
        if (updateThrough) {
          dateFilter = new Date(Date.parse(updateThrough));
          dateFilter = dateFilter.toISOString().slice(0, -1) + "Z";
          console.log("Looking for results after", updateThrough, "submitting as", dateFilter);
        }
        dashboardNoteContents = await _noteContent(this._noteContents, dashboardNote);
        let dashboard = await _sectionsFromMarkdown(dashboardNoteContents, this.constants.dashboardConstants.dashboardBookListTitle, _tableFromMarkdown);
        dashboard = _groupByValue(
          dashboard,
          (item) => {
            return _sectionNameFromLastHighlight(item.Updates);
          }
        );
        let readwiseBookCount = await this.readwiseModule._getReadwiseBookCount(app, this.constants.readwiseConstants);
        if (readwiseBookCount) {
          await _updateDashboardDetails(app, dashboard, this.constants.dashDetails, dateFormat, details, { bookCount: readwiseBookCount });
        }
        for await (const readwiseBook of this.readwiseModule._readwiseFetchBooks(app, this.constants.readwiseConstants, { dateFilter, categoryFilter })) {
          if (this._abortExecution)
            break;
          if (!readwiseBook)
            continue;
          if (bookCount >= this.constants.maxBookLimit)
            break;
          const bookNote = await _ensureBookNote(app, this.constants.bookConstants, readwiseBook, dashboardNote);
          const bookObject = _bookObjectFromReadwiseBook(readwiseBook, bookNote.uuid, dateFormat);
          await _ensureBookInDashboardNoteTable(app, dashboard, bookObject);
          if (typeof this._noteContents[bookNote.uuid] === "undefined") {
            if (Object.keys(this._noteContents).length >= this.constants.maxBookLimitInMemory) {
              await _flushLocalNotes(app, this._noteContents);
            }
          }
          const success = await this._syncBookHighlights(app, bookNote, readwiseBook.id, { readwiseBook });
          if (success)
            bookCount += 1;
        }
        await _noteContent(this._noteContents, dashboardNote);
        let tableRowCount = Object.values(dashboard).reduce((total, curr) => total + curr.length, 0);
        await _updateDashboardDetails(app, dashboard, this.constants.dashDetails, dateFormat, details, { tableRowCount });
        let markdownDetails = _writeDetails(details);
        await _replaceContent(this._noteContents, dashboardNote, this.constants.dashboardLibraryDetailsHeading, markdownDetails);
        await _writeDashboard(app, this._noteContents, dashboard, dashboardNote, this.constants.dashboardConstants);
        await _flushLocalNotes(app, this._noteContents);
        if (this._abortExecution) {
          await app.alert(`\u2705\uFE0F ${bookCount} book${bookCount === "1" ? "" : "s"} refreshed before canceling sync.`);
        } else {
          await app.alert(`\u2705 ${bookCount} book${bookCount === "1" ? "" : "s"} fetched & refreshed successfully!`);
        }
      } catch (error) {
        if (this._testEnvironment) {
          console.log(error);
          throw error;
        } else {
          console.trace();
          await app.alert(String(error));
          this._abortExecution = true;
        }
      } finally {
        this._useLocalNoteContents = false;
      }
    },
    /*******************************************************************************************/
    async _syncThisBook(app, noteUUID) {
      try {
        const currentNote = await app.notes.find(noteUUID);
        const noteTitle = currentNote.name;
        const titleRegex = /ID\s?#([\d]+)/;
        const match = noteTitle.match(titleRegex);
        if (!match) {
          throw new Error("The note title format is incorrect. It should contain an 'ID' designator, like 'ID: #123', in the title");
        }
        const bookId = match[1];
        const success = await this._syncBookHighlights(app, currentNote, bookId, { throwOnFail: true });
        await _flushLocalNotes(app, this._noteContents);
        if (success) {
          await app.alert("\u2705 Book highlights fetched successfully!");
        }
      } catch (error) {
        await app.alert(String(error));
        throw error;
      }
    },
    /*******************************************************************************************
     * Sync highlights for a book into the note provided. This method does all of the propagation from
     * Readwise Highlight object to list of highlights in a note
     *
     * Returns true if successful
     */
    async _syncBookHighlights(app, bookNote, readwiseBookID, { readwiseBook = null, throwOnFail = false } = {}) {
      console.log(`_syncBookHighlights(app, ${bookNote}, ${readwiseBookID})`);
      const dateFormat = this._dateFormat || app && app.settings[this.constants.settingDateFormat] || "en-US";
      let lastUpdatedAt = await _getLastUpdatedTimeFromNote(app, this.constants, bookNote);
      if (this._forceReprocess) {
        lastUpdatedAt = null;
      }
      const noteContent = await _noteContent(this._noteContents, bookNote) || "";
      if (!noteContent.includes("# Summary")) {
        await _insertContent(this._noteContents, bookNote, "# Summary\n");
      }
      if (!readwiseBook) {
        let generator = this.readwiseModule._readwiseFetchBooks(app, this.constants.readwiseConstants, { bookIdFilter: readwiseBookID });
        let result = await generator.next();
        readwiseBook = result.value;
        if (!readwiseBook) {
          if (throwOnFail) {
            throw new Error(`Could not fetch book details for book ID ${readwiseBookID}, you were probably rate-limited by Readwise. Please try again in 30-60 seconds?`);
          } else {
            return false;
          }
        }
      }
      const summaryContent = _bookNotePrefaceContentFromReadwiseBook(app, this.constants.bookConstants, dateFormat, readwiseBook, bookNote.uuid);
      await _replaceContent(this._noteContents, bookNote, "Summary", summaryContent);
      let highlightsContent = "";
      if (!noteContent.includes("# Highlights")) {
        await _insertContent(this._noteContents, bookNote, "\n# Highlights\n", { atEnd: true });
      } else {
        highlightsContent = _sectionContent(noteContent, "Highlights");
      }
      let highlights = await _sectionsFromMarkdown(noteContent, "Highlights", _loadHighlights);
      let bookNoteHighlightList = await _bookHighlightsContentFromReadwiseBook(app, readwiseBook, highlights, lastUpdatedAt);
      let hlGroups = _groupByValue(
        bookNoteHighlightList,
        (item) => {
          if (!item.highlighted_at)
            return "No higlight date";
          let year = _yearFromDateString(item.highlighted_at);
          if (!year)
            return "No highlight date";
          return year;
        }
      );
      hlGroups = _distributeIntoSmallGroups(
        hlGroups,
        this.constants.bookConstants.maxBookHighlightsPerSection,
        this.constants.bookConstants.maxReplaceContentLength,
        _trimHighlights,
        dateFormat
      );
      let entries = Object.entries(hlGroups);
      entries.sort((a, b) => b[0].localeCompare(a[0]));
      let hlMarkdown = _markdownFromSections(app, entries, _markdownFromHighlights.bind(this));
      try {
        await _replaceContent(this._noteContents, bookNote, "Highlights", hlMarkdown);
      } catch (error) {
        console.log("Error replacing", readwiseBook.title, "content, length", hlMarkdown.length, " error", error);
      }
      let existingContent = "";
      if (!noteContent.includes("Sync History")) {
        await _insertContent(this._noteContents, bookNote, "\n# Sync History\n", { atEnd: true });
      } else {
        const match = noteContent.match(/#\sSync\sHistory\n([\s\S]+)$/m);
        existingContent = match ? match[1] : "";
      }
      await _replaceContent(this._noteContents, bookNote, "Sync History", `${this.constants.bookConstants.updateStringPreface}${_localeDateFromIsoDate(/* @__PURE__ */ new Date(), dateFormat)}
` + existingContent);
      return true;
    },
    /*******************************************************************************************/
    async _syncOnly(app) {
      try {
        const categories = ["books", "articles", "tweets", "supplementals", "podcasts"];
        let result = await app.prompt(
          "What category of highlights would you like to sync?",
          {
            inputs: [{
              type: "select",
              label: "Category",
              options: categories.map(function(value) {
                return { value, label: value };
              })
            }]
          }
        );
        if (result)
          await this._syncAll(app, result);
      } catch (err) {
        app.alert(err);
      }
    },
    /*******************************************************************************************/
    _initialize(app, readwiseModule) {
      if (readwiseModule)
        this.readwiseModule = readwiseModule;
      else
        this.readwiseModule = readwise_exports;
      this._abortExecution = false;
      this._columnsBeforeUpdateDate = 6;
      this._dateFormat = null;
      this._forceReprocess = false;
      this._noteContents = {};
      this._app = app;
      this._useLocalNoteContents = false;
      if (this._testEnvironment === void 0)
        this._testEnvironment = false;
    }
  };
  var plugin_default = plugin;
  return plugin;
})()
