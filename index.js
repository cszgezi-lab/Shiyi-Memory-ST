import {initST,activateST,disableST} from './src/st-bootstrap.js';

export { initProductShell } from './ui/product-view.js';
export { createProductShellController } from './src/product-shell-controller.js';
export * from './src/product-settings.js';
export {
  DEFAULT_USER_EXTRACTORS,
  DEFAULT_SUMMARY_LANGUAGE,
  PROMPT_LABELS,
  applyExtractors,
  buildPromptFromExtracted,
  extractSingleAssistantReply,
} from './src/user-extractors.js';

/** Mount UI and follow the current chat locally; model requests remain explicit/opt-in. */
export function init(options = {}) {
  return initST(options);
}
export function onActivate(){activateST();}
export function onEnable(){return initST();}
export function onDisable(){return disableST();}
export function onDelete(){return disableST();}
