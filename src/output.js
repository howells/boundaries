export const EXIT_CODES = {
  OK: 0,
  USAGE: 64,
  DATA: 65,
  UNAVAILABLE: 69,
  SOFTWARE: 70,
};

export function success(data, metadata = undefined) {
  return {
    success: true,
    data,
    ...(metadata ? { metadata } : {}),
  };
}

export function failure(error, data = undefined) {
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
  file = undefined,
}) {
  return {
    code,
    message,
    is_retriable,
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
