const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');

module.exports = {
    entry: './src/index.js',
    output: {
        filename: 'mpegts.js',
        path: path.resolve(__dirname, 'dist'),
        library: 'mpegts',
        libraryTarget: 'umd'
    },

    devtool: 'source-map',

    resolve: {
        extensions: ['.ts', '.tsx', '.js', '.json']
    },

    node: {
        'fs': 'empty',
        'path': 'empty'
    },

    optimization: {
        minimizer: [
            new TerserPlugin({})
        ]
    },

    module: {
        rules: [
            {
                test: /\.(ts|js)$/,
                use: 'ts-loader',
                exclude: /node-modules/
            },
            {
                enforce: 'pre',
                test: /\.js$/,
                use: 'source-map-loader'
            }
        ]
    }
};
