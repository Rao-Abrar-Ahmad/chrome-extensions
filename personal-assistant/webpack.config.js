const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
  entry: {
    offscreen: './offscreen.js',
    background: './background.js',
    sidepanel: './sidepanel.js',
    permission: './permission.js'
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    clean: true
  },
  mode: 'production',
  target: 'web',
  resolve: {
    fallback: {
      fs: false,
      path: false,
      crypto: false
    }
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: '*.html', to: '[name][ext]' },
        { from: '*.css', to: '[name][ext]' },
        { from: '*.json', to: '[name][ext]' },
        { from: 'icons/**/*', to: 'icons/[name][ext]' },
        { from: 'modules/**/*', to: 'modules/[name][ext]' }
      ]
    })
  ],
  optimization: {
    splitChunks: false,
    runtimeChunk: false
  }
};