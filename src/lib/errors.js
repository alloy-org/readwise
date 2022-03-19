// --------------------------------------------------------------------------
export class LoggedOutError extends Error {
  constructor(message) {
    super(message);

    this.constructor = LoggedOutError;
    this.__proto__ = LoggedOutError.prototype;
    this.message = message;
  }
}
