// -----------------------------------------------------------------------------
// Entry point of the Dyson integration for Gladys Assistant.
//
// Role of this file: wire the SDK to the Dyson manager (src/dyson/manager.js).
// It holds NO Dyson logic. It only:
//   1. instantiates the SDK (connection, auth, reconnection: handled for you);
//   2. registers the event handlers BEFORE connect();
//   3. connects.
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL         (host API URL)
//   - GLADYS_INTEGRATION_TOKEN    (integration-scoped JWT)
//   - GLADYS_INTEGRATION_SELECTOR (integration identifier)
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createDysonManager } from './src/dyson/manager.js';
import { createAccountStore } from './src/dyson/store.js';
import { SCENE_ACTIONS } from './src/capabilities/scenes.js';
import {
  WIDGETS,
  WIDGET_CONTENT,
  createWidgetNudger,
  handleWidgetAction,
  widgetImage,
} from './src/capabilities/widget.js';

const gladys = new GladysIntegration();

// Paced under the core's limit, so a nudge is held rather than dropped.
const nudger = createWidgetNudger((key) => gladys.requestWidgetRefresh(key));
function refreshWidgets() {
  for (const key of WIDGETS) {
    nudger.nudge(key);
  }
}
const dyson = createDysonManager({
  gladys,
  store: createAccountStore(),
  // The widgets' computed parts (mode, connection, air quality levels)
  // changed: nudge open dashboards (fire-and-forget, rate-limited by the core).
  onDeviceChange: refreshWidgets,
});

// --- Discovery: Gladys asks for the list of devices --------------------------
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> publishing the Dyson devices of the account');
  await dyson.scan();
});

// --- Command: the user acts on a controllable feature ------------------------
// Throwing sends a success:false acknowledgement to Gladys.
gladys.onSetValue(async (device, feature, value) => {
  logger.info(`onSetValue <- ${feature.external_id} = ${value}`);
  await dyson.setValue(device, feature, value);
});

// --- Devices added or removed in Gladys: open or close their link ------------
// getDevices() refreshes gladys.devices, which the manager reads.
async function syncDevices() {
  await gladys.getDevices();
  await dyson.syncLinks();
}
gladys.onDeviceCreated(syncDevices);
gladys.onDeviceDeleted(syncDevices);

// --- Manifest actions: buttons in the Configuration screen -------------------
gladys.onAction('request_code', () => dyson.requestCode());
gladys.onAction('verify_code', (fields) => dyson.verifyCode(fields.code));
gladys.onAction('test_connection', () => dyson.testConnection());
gladys.onAction('sign_out', () => dyson.forgetAccount());

// --- Scene actions (Gladys 5.1+) ----------------------------------------------
// The scene TRIGGERS need no handler: the manager fires them with
// publishSceneEvent (see src/capabilities/triggers.js).
for (const [actionKey, handler] of Object.entries(SCENE_ACTIONS)) {
  gladys.onSceneAction(actionKey, (fields) => handler(dyson, fields));
}

// --- Dashboard widgets (Gladys 5.1+) ------------------------------------------
for (const key of WIDGETS) {
  gladys.onWidgetGet(key, (request) => WIDGET_CONTENT[key](dyson, request));
  gladys.onWidgetAction(key, (actionKey, params, { values } = {}) =>
    handleWidgetAction(dyson, { actionKey, params, values }),
  );
}
// One handler for every image key: the product drawings of the controls widget.
gladys.onWidgetGetImage(widgetImage);

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> new configuration received');
  await dyson.updateConfig(newConfig);
});

// --- Connection lifecycle ----------------------------------------------------
// The SDK logs the WebSocket lifecycle itself (gladys-sdk); this only runs the
// integration's own (re)initialization.
gladys.on('connected', async () => {
  try {
    await dyson.start(await gladys.getConfig());
    // Nudges sent while the socket was down were dropped: re-sync dashboards.
    refreshWidgets();
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
    await gladys
      .setConnectionStatus(false, {
        en: 'Initialization failed, check the integration logs.',
        fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
      })
      .catch(() => {});
  }
});

// A rejection nobody awaited (a late MQTT callback...) is logged, never fatal.
process.on('unhandledRejection', (err) => {
  logger.error('Unhandled promise rejection', err);
});

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> closing the Dyson connections`);
  dyson.stop();
  nudger.stop();
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the Dyson integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
