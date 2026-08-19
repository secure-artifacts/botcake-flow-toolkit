export const APP_ID = "botcake-flow-toolkit";
export const TEMPLATE_FORMAT = "botcake-flow-template";
export const TEMPLATE_VERSION = 1 as const;
export const MAX_REMOTE_FILE_BYTES = 30 * 1024 * 1024;
export const MAX_ARCHIVE_FILES = 200;
export const MAX_UNZIPPED_BYTES = 80 * 1024 * 1024;

export const FLOW_URL_PATTERN = /^https:\/\/botcake\.io\/(\d+)\/flows\/(\d+)\/content(?:[/?#]|$)/;
export const DEFAULT_REPLY_EDIT_URL_PATTERN = /^https:\/\/botcake\.io\/(\d+)\/default\/edit(?:[/?#]|$)/;
