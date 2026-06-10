export function createProductPulsePerfLogger() {
  return {
    mark() {},
    done() {},
    fail() {},
  };
}

export async function measureProductPulseStep(_perf, _stage, callback) {
  return callback();
}
