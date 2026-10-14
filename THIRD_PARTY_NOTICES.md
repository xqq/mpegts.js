# Third-party notices

## @breezystack/lamejs 1.2.7

G.711 FLV audio is decoded by mpegts.js and synchronously encoded to MP3 using
the unmodified `@breezystack/lamejs` package (LGPL-3.0). It is a JavaScript port
of [LAME](https://lame.sourceforge.net/), maintained from Alex Zhukov's lamejs.

- Package and corresponding source: https://www.npmjs.com/package/@breezystack/lamejs/v/1.2.7
- Source repository: https://github.com/shijinyu/lamejs
- Original port: https://github.com/zhuker/lamejs
- LGPL-3.0: https://www.gnu.org/licenses/lgpl-3.0.html

The encoder is bundled into `dist/mpegts.js`; its license is separate from the
Apache-2.0 license of mpegts.js. The pinned dependency and `package-lock.json`
allow rebuilding the bundle, or replacing the encoder, with `npm ci` and
`npm run build`. No modifications to the encoder are included in this change.

The package's LICENSE notice is reproduced below:

> Can I use LAME in my commercial program?
>
> Yes, you can, under the restrictions of the LGPL. The easiest way to do this is to:
>
> 1. Link to LAME as separate jar (lame.min.js or lame.all.js)
> 2. Fully acknowledge that you are using LAME, and give a link to our web site, lame.sourceforge.net
> 3. If you make modifications to LAME, you must release these modifications back to the LAME project, under the LGPL.
