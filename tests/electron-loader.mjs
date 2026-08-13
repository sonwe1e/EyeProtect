// Node module-customization hook: redirect bare 'electron' imports to the local
// stub so the ReminderSurfaceManager can be unit-tested under plain Node.
const stubUrl = new URL('./electron-stub.mjs', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') {
    return { url: stubUrl, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
