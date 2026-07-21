export const EXIT_CODES = {
  DATA: 65,
  OK: 0,
  SOFTWARE: 70,
  UNAVAILABLE: 69,
  USAGE: 64,
};

export function success(data, metadata) {
  return {
    data,
    success: true,
    ...(metadata ? { metadata } : {}),
  };
}

export function failure(error, data) {
  return {
    success: false,
    ...(data ? { data } : {}),
    error: problem(error),
  };
}

function problem({
  code,
  message,
  is_retriable = false,
  suggestions = [],
  file,
}) {
  return {
    code,
    is_retriable,
    message,
    suggestions,
    ...(file ? { file } : {}),
  };
}

export function writeJson(stream, value) {
  stream.write(`${JSON.stringify(value)}\n`);
}

export function hasFlag(args, flag) {
  return args.includes(flag);
}

export function stripFlags(args, flags) {
  return args.filter((arg) => !flags.includes(arg));
}
