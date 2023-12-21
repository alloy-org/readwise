/*******************************************************************************************/
/* Date manipulation
/*******************************************************************************************/

/*******************************************************************************************
 * Returns the year as YYYY safely from a date string like January 1, 2023 at 5:00pm
 */
export function _yearFromDateString(dateString) {
  const dateObject = _dateObjectFromDateString(dateString);
  if (!dateObject) return null;
  return dateObject.getFullYear();
}

/*******************************************************************************************
 * Returns human-friendly date string from date object.
 */
export function _localeDateFromIsoDate(dateStringOrObject, dateFormat) {
  console.debug(`_localeDateFromIsoDate(app, ${dateStringOrObject}`);
  try {
    if (!dateStringOrObject) return "";
    const dateObject = new Date(dateStringOrObject);
    let result = dateObject.toLocaleDateString(dateFormat, { month: "long", day: "numeric", year: "numeric" });
    const recentDateCutoff = (new Date()).setDate((new Date()).getDate() - 3);
    if (dateObject > recentDateCutoff) {
      result += " " + dateObject.toLocaleTimeString(dateFormat, { hour: "numeric", minute: "2-digit", hour12: true });
    }
    return result;
  } catch (e) {
    console.error("There was an error parsing your date string", dateStringOrObject, e);
    return dateStringOrObject;
  }
}

/*******************************************************************************************
 * A regular expression whose [1] match will be the "Updated at" string
 */
export function _updateStampRegex() {
  return new RegExp(`^(?:\\|[^|]*){${ this._columnsBeforeUpdateDate }}\\|\\s*([^|]+)\\s*\\|.*(?:$|[\\r\\n]+)`, "gm");
}

/*******************************************************************************************
 * `dateString` a string like January 1, 2023 at 5:00pm
 */
export function _dateObjectFromDateString(dateString) {
  console.log("_dateObjectFromDateString", dateString);
  let attemptDate = Date.parse(dateString);
  if (!dateString) return null;
  let parseableString;
  try {
    parseableString = dateString.toLowerCase().replace(/\s?[ap]m/, "").replace(" at ", " ");
  } catch (err) {
    if (err.name === "TypeError") {
      throw(new Error(`${ err.message } (line 1293)`));
    }
  }
  const parsedDate = Date.parse(parseableString);
  if (parsedDate) {
    return new Date(parsedDate);
  } else {
    return null;
  }
}

/*******************************************************************************************
 * Given a note handle, returns the "last updated at" time, if any.
 * Returns null if none was found.
 */
export async function _getLastUpdatedTimeFromNote(app, constants, noteHandle) {
  const content = await app.getNoteContent({ uuid: noteHandle.uuid });
  if (!content) return null;

  const lines = content.split("\n");
  if (lines.length === 0) {
    console.log("Found empty note parsing for date.");
    return null;
  }

  // Translate our human friendly "June 6, 2023 at 5:01pm" into an object that Date.parse understands, e.g., June 6, 2023 17:01
  const dateLine = lines.find(line => line.includes(constants.bookConstants.updateStringPreface));
  let result = null;
  if (dateLine) {
    let dateString;
    try {
      dateString = dateLine.replace(constants.bookConstants.updateStringPreface, "");
      if (dateString.includes("pm")) {
        const hourMatch = dateString.match(/at\s([\d]{1,2}):/);
        if (hourMatch) {
          dateString = dateString.replace(` ${ hourMatch[1] }:`, ` ${ parseInt(hourMatch[1]) + 12 }:`);
        } else {
          console.error("Error parsing dateString");
        }
      }
    } catch (err) {
      if (err.name === "TypeError") {
        throw(new Error(`${ err.message } (line  1335)`));
      }
    }
    const result = _dateObjectFromDateString(dateString);
    if (!result || isNaN(result.getTime())) {
      console.log("Could not ascertain date from", dateLine, "and dateString", dateString);
      return null;
    }
  } else {
    console.log("Couldn't find a line containing the update time for note", noteHandle.uuid);
  }

  if (result) console.debug(`Last updated detected: ${ result.getTime() }`);
  return result;
}


