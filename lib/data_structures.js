import { _markdownFromHighlights } from './markdown.js';
/*******************************************************************************************/
/* Data structures
/*******************************************************************************************/

/*******************************************************************************************
 * Given a flat array of objects (toGroup), return an object of key: value, which effectively
 * groups objects from the original array based on a criteria. The criteria is defined by the 
 * "groupFunction" passed as input, which is called on each individual object from the original
 * array. The return value of "groupFunction" is used as the "key", and the "value" will be a 
 * list of objects.
 *
 * Used to group books/highlights into sections corresponding to the year of the last update,
 * but can be used to group by arbitrary properties.
 */
export function _groupByValue(toGroup, groupFunction) {
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

/*******************************************************************************************
 * Given an object of type group: array, create subgroups of "groupSize" maximum length.
 */
export function _distributeIntoSmallGroups(source, groupSize, trimSize, trimFunction, dateFormat) {
  let result = {};
  for (let group of Object.keys(source)) {
    let groupRows = [ ... source[group]];
    let chunks = [];
    while (groupRows.length) {
      let toPush = groupRows.splice(0, groupSize);
      if (trimFunction) {
        toPush = trimFunction(trimSize, toPush, dateFormat);
      }
      chunks.push(toPush);
    }

    chunks.forEach((chunk, index) => {
      result[`${ group }${ index > 0 ? ' (part ' + (index + 1)  +')' : ''}`] = chunk;
    });
  }
  return result;
}

export function _trimHighlights(trimSize, toPush, dateFormat) {
  let groupMarkdown = _markdownFromHighlights(toPush, dateFormat);
  // Preview the markdown that will be generated; is it longer than 100k characters?
  if (groupMarkdown.length < trimSize) return toPush;

  console.log("Trimming highlights for length...");
  // When trimming highlights, trim only those exceeding 100.000 divided by how many 
  //  highlights we have in the group
  const itemTextLimit = trimSize / toPush.length -
    "> ### \n\n".length - "**Highlighted at**: \n".length - // Subtract the characters that we insert next to the highlight text itself
    " (Trimmed for length)".length - // Subtract the text we add to explain a highlight was trimmed
    30; // Subtract the length of the date string

  for (const item of toPush) {
    if (item.text.length > itemTextLimit) {
      // Remove note and color fields from overflowing highlights
      item.note = null;
      item.color = null;
      item.text = item.text.slice(0, itemTextLimit) + " (Trimmed for length)";
    }
  }
  return toPush;
}

