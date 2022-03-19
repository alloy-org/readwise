export const log = (...msgs) => {
  if (process.env.NODE_ENV === "development") {
    console.log(...msgs)
  }
}

export const logE = (...msgs) => {
  // TODO send exception to sentry

  if (process.env.NODE_ENV === "development") {
    console.error(...msgs)
  }
}
