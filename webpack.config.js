const webpack = require('webpack');
const packagejson = require("./package.json");
const path = require('path');

module.exports = {
    entry: './src/index.js',

    // Keep ES5 output: the vendored webworkify shim reconstructs worker source
    // from Function.prototype.toString() of the module wrappers, which requires
    // classic function expressions rather than arrow functions.
    target: ['web', 'es5'],

    output: {
        filename: 'mpegts.js',
        path: path.resolve(__dirname, 'dist'),
        library: {
            name: 'mpegts',
            type: 'umd'
        },
        globalObject: 'this'
    },

    devtool: 'source-map',

    optimization: {
        // The worker entry modules (src/core/transmuxing-worker.js and
        // src/player/player-engine-worker.ts) are only ever reached through
        // work(require.resolve(...)), which yields a module id rather than a binding, so
        // nothing in the bundle statically imports their default export. webpack 5's
        // usedExports analysis therefore marks that export unused and the minifier drops
        // the module body, leaving an import-only stub. webworkify evaluates
        // `f.default || f` to `{}` inside the generated Worker, so `new f(self)` throws
        // and both worker paths silently fall back to running on the main thread.
        // webpack 4 kept the exports; this regressed in the webpack 5 migration.
        usedExports: false
    },

    resolve: {
        extensions: ['.ts', '.tsx', '.js', '.json'],
        fallback: {
            // webpack 5 no longer polyfills node core modules automatically
            'events': require.resolve('events')
        }
    },

    plugins: [
        new webpack.BannerPlugin('Includes @breezystack/lamejs 1.2.7 (LGPL-3.0), based on LAME/lamejs. See THIRD_PARTY_NOTICES.md for source and license information.'),
        new webpack.DefinePlugin({
          __VERSION__: JSON.stringify(packagejson.version)
        })
    ],

    module: {
        rules: [
            {
                test: /\.(ts|js)$/,
                use: 'ts-loader',
                exclude: /node_modules/
            },
            {
                enforce: 'pre',
                test: /\.js$/,
                use: 'source-map-loader',
                exclude: /node_modules/
            }
        ]
    },

    devServer: {
        static: ['demo'],

        client: {
            overlay: {
                errors: true,
                warnings: false,
                // The demo deliberately exercises failure paths (bad URLs, unsupported
                // codecs, aborted playback), and webpack-dev-server >= 4.13 turns any
                // uncaught error or unhandled rejection into a full-screen overlay that
                // makes the page untestable. Errors still surface in the console.
                runtimeErrors: false
            }
        },

        proxy: [
            {
                context: ['/dist'],
                target: 'http://localhost:8080',
                pathRewrite: {'^/dist' : ''}
            }
        ]
    }
};
