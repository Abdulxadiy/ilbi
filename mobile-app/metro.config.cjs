/* global __dirname:readonly */
const path = require('node:path');
const { mkdirSync } = require('node:fs');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// CNG copies share node_modules. Router contexts contain a project-root path.
config.cacheVersion = `${config.cacheVersion || ''}:${__dirname}`;
config.cacheStores = ({ FileStore }) => [new FileStore({ root: path.join(__dirname, '.expo', 'metro-cache') })];
config.fileMapCacheDirectory = path.join(__dirname, '.expo', 'metro-file-map');
mkdirSync(config.fileMapCacheDirectory, { recursive: true });
config.maxWorkers = 2;
module.exports = config;
