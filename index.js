import { registerRootComponent } from 'expo';

import App from './App';

// Global safety net: tag ANY unhandled promise rejection / JS error with its
// message + stack in the console (Metro terminal) while preserving the
// default LogBox/redbox behavior. This makes the next occurrence identify
// its exact file/line instead of a bare "Possible Unhandled Promise" box.
try {
  const EU = typeof ErrorUtils !== 'undefined' ? ErrorUtils : null;
  if (EU && EU.setGlobalHandler && EU.getGlobalHandler && !globalThis.__jesyonGlobalHandlerInstalled) {
    globalThis.__jesyonGlobalHandlerInstalled = true;
    const prevHandler = EU.getGlobalHandler();
    EU.setGlobalHandler((error, isFatal) => {
      try {
        const msg = (error && error.message) || String(error);
        const stack = (error && error.stack) || '';
        // eslint-disable-next-line no-console
        console.log(`[Jesyon Unhandled${isFatal ? ' FATAL' : ''}]`, msg, stack ? `\n${stack}` : '');
      } catch {}
      if (prevHandler) prevHandler(error, isFatal);
    });
  }
} catch {}

registerRootComponent(App);
