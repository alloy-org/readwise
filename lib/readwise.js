/*******************************************************************************************/
/* Readwise APIs
/*******************************************************************************************/

/*******************************************************************************************
 * Return count of books reported by Readwise
 */
let _requestsCount = 0;
let _lastRequestTime = 0;

export async function _getReadwiseBookCount(app, constants) {
  const bookIndexResponse = await _readwiseMakeRequest(app, constants, `${ constants.readwiseBookIndexURL }?page_size=1`);
  if (bookIndexResponse?.count) {
    return bookIndexResponse.count;
  }
  else {
    console.log("Did not received a Book index response from Readwise. Not updating Dashboard content");
    return null;
  }
}

export async function* _testLongReadwiseFetchBooks(app, {bookIdFilter=null, categoryFilter=null, dateFilter=null} = {}) {
  // TODO: add this as an automated test, please
  let hls = [...Array(10).keys()];
  hls = hls.map(item => ({
        "id": item,
        "text": "a".repeat(10000),
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
    "highlights": hls,
  };
}

/*******************************************************************************************
 * Returns the `book` json object from Readwise. Currently contains keys for [id, title, author, category, source,
 * cover_image_url], and other stuff enumerated at https://readwise.io/api_deets under "Books LIST"
 */
export async function* _readwiseFetchBooks(app, constants, {bookIdFilter=null, categoryFilter=null, dateFilter=null} = {}) {
  const url = new URL(`${ constants.readwiseExportURL }`);
  if(bookIdFilter) url.searchParams.append("ids", bookIdFilter);
  // Only apply date filters if we're fetching ALL types of books
  if(dateFilter && !categoryFilter) url.searchParams.append("updatedAfter", dateFilter);
  for await (const item of _readwisePaginateExportRequest(app, constants, url)) {
    if (categoryFilter && item.category !== categoryFilter) continue;
    yield item;
  }
}

/*******************************************************************************************
 * Handles pagination for the /export Readwise API. Generator.
 */
export async function* _readwisePaginateExportRequest(app, constants, url) {
  let nextPage = false;

  while (true) {
    if (nextPage) url.searchParams.set("pageCursor", nextPage);
    const data = await _readwiseMakeRequest(app, constants, url);
    if (data) {
      for (const item of data.results) {
        // Update fields such because Readwise's EXPORT returns slightly different names than LIST
        item.id = item.user_book_id;
        item.num_highlights = item.highlights.length;

        // Sort highlights by date descending
        let hls = item.highlights;
        hls = hls.sort((a, b) => {
          // Sort highlights with missing date fields at the bottom
          if (a.highlighted_at === undefined) return 1;
          if (b.highlighted_at === undefined) return -1;
          return new Date(b.highlighted_at) - new Date(a.highlighted_at);
        });
        item.highlights = hls;
        item.last_highlight_at = null;
        if (hls[0]) item.last_highlight_at = hls[0].highlighted_at;

        yield item;
      }
      nextPage = data.nextPageCursor;
      if (!nextPage) break;
    } else {
      console.error("Breaking from pagination loop due to no response from request", url);
      break;
    }
  }
}

/*******************************************************************************************
 * Returns a generator of highlights, given a book ID
 */
export async function* _readwiseGetAllHighlightsForBook(app, bookId, updatedAfter) {
  console.log(`_readwiseGetAllHighlightsForBook(app, ${ bookId }, ${ updatedAfter })`);
  const url = new URL(`${ this.constants.readwiseHighlightsIndexURL }/`);
  const params = new URLSearchParams();
  params.append('book_id', bookId);

  if (updatedAfter) {
    params.append('updated__gt', updatedAfter.toISOString().slice(0, -1) + 'Z');
  }

  url.search = params;

  yield* _readwisePaginateRequest(app, url);
}

/*******************************************************************************************
 * Returns a generator of results as found in data.results.
 * Paginates results given a baseURL, by adding &page= at the end of the path.
 */
export async function* _readwisePaginateRequest(app, constants, baseUrl) {
  let currentPage = 1;
  let hasNextPage = true;

  while (hasNextPage) {
    baseUrl.searchParams.append('page', currentPage);
    baseUrl.searchParams.append('page_size', constants.readwisePageSize);
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

/*******************************************************************************************
 * Makes a request to Readwise, adds authorization Headers from app.settings.
 * Returns the response.json() object of the request.
 */
export async function _readwiseMakeRequest(app, constants, url) {
  console.log(`_readwiseMakeRequest(app, ${url.toString()})`);
  const readwiseAPIKey = app.settings["Readwise Access Token"];
  if (!readwiseAPIKey || readwiseAPIKey.trim() === '') {
    throw new Error('Readwise API key is empty. Please provide a valid API key.');
  }

  const headers = new Headers({ "Authorization": `Token ${ readwiseAPIKey }`, "Content-Type": 'application/json' , "Origin": "https://plugins.amplenote.com", "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"});

  // Wait to ensure we don't exceed the requests/minute quota of Readwise
  await _ensureRequestDelta(app, constants);

  let proxyUrl;
  // Requests to cors proxies will fail from electron & mobile; attempt once and remove proxy if we get 400
  proxyUrl = `https://plugins.amplenote.com/cors-proxy/${ url.toString() }`;
  const tryFetch = async () => {
    const response = await fetch(proxyUrl, { method: 'GET', headers });
    if (!response.ok) {
      console.error(`HTTP error. Status: ${ response.status }`);
      if (response.status == 400) { // We might be trying a fetch to a CORS from outside a browser (mobile/electron)
        proxyUrl = url.toString();
        const response = await fetch(proxyUrl, { method: 'GET', headers });
        if (response.ok) return response.json();
      }
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
      await new Promise(resolve => setTimeout(resolve,constants.sleepSecondsAfterRequestFail * 1000));
      return await tryFetch();
    }
  } catch (e) {
    console.trace();
    console.error("Handling", e, "stack", e.stack);
    app.alert("Error making request to Readwise", e);
    return null;
  }
}

/*******************************************************************************************
 * Blocks until the next request can be made, as specified by this.constants.rateLimit.
 */
export async function _ensureRequestDelta(app, constants) {
  const currentTime = new Date(); // Get the current time

  if (_lastRequestTime) { // Check if there was a previous request
    const timeDifference = (currentTime - _lastRequestTime) / 60000; // Calculate the time difference in minutes

    if (timeDifference >= 1) {
      _requestsCount = 0; // Reset the request count if more than 1 minute has passed
    }

    // Check if the request count is greater than or equal to the rate limit
    if (_requestsCount >= constants.rateLimit) {
      const waitTime = 60000 - timeDifference * 60000; // Calculate the remaining time in milliseconds before the next minute is reached
      // Alert the user about the waiting time
      const alertMessage = `Waiting for ${ Math.floor(waitTime / 1000) } seconds to satisfy Readwise API limit...\n\n` +
        `You can wait here, or click "DONE" to dismiss, and we will update notes in the background as you work. ⏳\n\n` +
        `Working concurrently while notes are being changed could lead to merge issues, so we recommend minimizing note changes while a sync is underway.`;
      const response = await app.alert(alertMessage, { actions: [ { label: "Cancel sync", icon: "close" } ]});

      if (response === 0) {
        console.debug("User cancelled sync");
      } else {
        await new Promise((resolve) => setTimeout(resolve, waitTime)); // Wait for the remaining time before making the next request
        _requestsCount = 0; // Reset the request count after waiting
      }
    }
  }
  _lastRequestTime = currentTime; // Update the last request time to the current time
  _requestsCount++; // Increment the request count
}