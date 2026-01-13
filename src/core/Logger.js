export class Logger {
  constructor(scope = "core") {
    this.scope = scope;
  }

  _log(level, message, meta) {
    const payload = {
      ts: new Date().toISOString(),
      level,
      scope: this.scope,
      message
    };
    if (meta && Object.keys(meta).length > 0) {
      payload.meta = meta;
    }
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(payload));
  }

  info(message, meta = {}) {
    this._log("info", message, meta);
  }

  warn(message, meta = {}) {
    this._log("warn", message, meta);
  }

  error(message, meta = {}) {
    this._log("error", message, meta);
  }

  debug(message, meta = {}) {
    if (process.env.JAVASPECTRE_DEBUG === "1") {
      this._log("debug", message, meta);
    }
  }
}

const defaultLogger = new Logger("core");
export default defaultLogger;
