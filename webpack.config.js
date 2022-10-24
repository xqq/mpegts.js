const webpack = require('webpack');
const packagejson = require("./package.json");
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

    plugins: [
        new webpack.DefinePlugin({
          __VERSION__: JSON.stringify(packagejson.version)
        })
    ],

    node: {
        'fs': 'empty',
        'path': 'empty'
    },

    optimization: {
        minimizer: [
            new TerserPlugin({
                sourceMap: true
            })
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
    },

    devServer: {
        static: ['demo'],
        proxy: {
            '/dist': {
                target: 'http://localhost:8080',
                pathRewrite: {'^/dist' : ''}
            }
        }
    }
};
