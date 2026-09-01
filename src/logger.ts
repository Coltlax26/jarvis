type Fields = Record<string, unknown>;

function line(level: string, msg: string, fields?: Fields) {
  const rec = { t: new Date().toISOString(), level, msg, ...fields };
  process.stdout.write(JSON.stringify(rec) + "\n");
}

export const logger = {
  info: (msg: string, fields?: Fields) => line("info", msg, fields),
  warn: (msg: string, fields?: Fields) => line("warn", msg, fields),
  error: (msg: string, err?: unknown, fields?: Fields) =>
    line("error", msg, {
      ...fields,
      error:
        err instanceof Error
          ? { name: err.name, message: err.message, stack: err.stack }
          : err,
    }),
};
