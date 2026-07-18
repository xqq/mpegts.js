// entry/index file

// make it compatible with browserify's umd wrapper
/** @type {typeof import('./mpegts.js').default} */
const mpegts = require('./mpegts.js').default

module.exports = mpegts
