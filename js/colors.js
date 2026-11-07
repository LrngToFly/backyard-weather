/* Backyard Weather: color tables and break points (copied from Tropical Tidbits' own legends). */
'use strict';

// Colors and break points copied from Tropical Tidbits' own legends (precip rates in mm/hr, totals in inches).
var RATE_T = [0.1, 0.25, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 30, 36, 42];
var RATE_C = [
  '#99f26c', '#8bdc62', '#7cc558', '#6dae4d', '#5f9842', '#4f8038', '#406a2d', '#325424',
  '#fafe74', '#ecd565', '#e1ac58', '#d8854b', '#d05138', '#b5413a', '#98343d', '#7d2a42',
  '#a53ba0', '#bc45ba', '#d44fd4'
];
var RAIN_T = [0.1, 0.25, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 30];
var RAIN_C = [
  '#99f26c', '#8bdc62', '#7cc558', '#6dae4d', '#5f9842', '#4f8038', '#406a2d', '#325424',
  '#fafe74', '#ecd565', '#e1ac58', '#d8854c', '#d05035', '#b5423b', '#96363c', '#7e2c3f',
  '#9d3b97', '#d44fd4'
];
var FRZ_T = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 10, 12, 14];
var FRZR_C = [
  '#e2a7be', '#d491af', '#cd89a5', '#c06f96', '#b9648b', '#ae537d', '#a2446f', '#993b63',
  '#8c314d', '#923442', '#983738', '#a03f2c', '#ab4627', '#b24b26', '#be5424', '#c85b26',
  '#d2632a'
];
var SLEET_C = [
  '#b19df6', '#b091f6', '#b17ef6', '#af72f3', '#ab64ee', '#a453e4', '#9842d4', '#913bc9',
  '#8230ac', '#8331a9', '#8e3581', '#963c8e', '#9b4084', '#a44779', '#ab4f6f', '#b35765',
  '#b95c5c'
];
var SNOWR_C = [
  '#a4f7fd', '#97e2f7', '#88c9f9', '#7fb8f8', '#74a6f7', '#6890f6', '#5167e1', '#4552d4',
  '#3a3ec6', '#302cb5', '#2a1fa9', '#270e95', '#2c1290', '#441f81', '#8a3280', '#ad3e81',
  '#cf4b7d'
];
var ACC_T = [0.01, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 7, 8, 9, 10, 12, 14, 16, 20, 24];
var ACC_C = [
  '#c8e9d1', '#b1d4ba', '#99bda1', '#81a688', '#6a8f70', '#547a58', '#3c5e3d', '#436184',
  '#5b7a9a', '#7291b1', '#8ba9c4', '#a5c1db', '#bfd8ef', '#e4d7e9', '#d1c0d6', '#bcaac2',
  '#a892af', '#947b9c', '#81648a', '#6c4d76', '#593662', '#571b32', '#6f343c', '#8c5448',
  '#a77655', '#c59962', '#e6c97b', '#ead688', '#f1e493', '#f6f1a0', '#fcfeac'
];
var SNOW_T = [0.1, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5, 7.0, 7.5, 8.0, 8.5, 9.0, 9.5, 10.0, 10.5, 11.0, 11.5, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48];
var SNOW_C = [
  '#444696', '#585ea3', '#6d77b0', '#8390bf', '#98a8cd', '#aec2db', '#b6bee0', '#a8a0d8',
  '#9d86d1', '#926bc9', '#8a52c0', '#7e3bb4', '#a35294', '#a75d9a', '#ae68a2', '#b473a9',
  '#b678ac', '#bf8bb7', '#c697bf', '#cba3c7', '#d2afce', '#d9bcd7', '#dfc8dd', '#e7d5e5',
  '#deefe7', '#cfe7dc', '#c0dfd0', '#b1d8c6', '#a3d0ba', '#97caaf', '#7fb395', '#74a488',
  '#69957c', '#5a816b', '#517561', '#466854', '#4a477d', '#555380', '#616082', '#6e6c87',
  '#757485', '#85858d', '#9d9d94', '#a9aaa0', '#b6b7ad', '#c3c4ba', '#d1d1c7', '#ddddd4',
  '#e9eae0'
];
// 2 m temperature: one color per degree F from -70 to 130, blended to quarter degrees
var TMIN = -70, TMAX = 130;
var TCOL = [
  '#ddc7ec', '#dfc3ed', '#d9b2e6', '#d9aee5', '#d7a2dc', '#d49dd3', '#d295cb', '#d393c8', '#d182be', '#d07bba',
  '#cf74b6', '#cf73b5', '#cf69ad', '#ce5ea2', '#ce5b9f', '#ce5a9e', '#cf5191', '#cf5191', '#cc4c85', '#cb4b81',
  '#cb4b81', '#cb4b81', '#cb4b81', '#cb4b81', '#c84a82', '#c64a82', '#c04982', '#bf4982', '#bc4982', '#bc4982',
  '#bb4982', '#ba4982', '#b74a82', '#b74a82', '#b14b83', '#af4c83', '#af4c83', '#af4c83', '#ae4e85', '#ad4f85',
  '#ac528a', '#aa578e', '#ab5890', '#ab5890', '#ae649f', '#af69a3', '#b06da8', '#b06da8', '#b171ac', '#b47eb9',
  '#b07ebc', '#b07ebc', '#a275b8', '#976db5', '#9369b2', '#8b63b0', '#815dac', '#8058a9', '#6f53a3', '#6f53a3',
  '#6f53a3', '#7054a3', '#7863ae', '#8a77b9', '#8f7ebb', '#9d8ec6', '#a299ce', '#afabd7', '#b4b2db', '#cfd0e0',
  '#cacadf', '#b9b7dc', '#b3b0da', '#a49ed0', '#9893cc', '#8987ca', '#8080cb', '#736fc2', '#726abb', '#5752b3',
  '#5752b3', '#5752b3', '#5754b7', '#575bc2', '#575bc2', '#5a65cf', '#5c6bd6', '#5d6cd7', '#5f71dc', '#637be5',
  '#6682eb', '#6a8af0', '#6c8ff1', '#75a1f5', '#7baff7', '#7db1f8', '#80b8f8', '#8ccefa', '#91d5fa', '#98e2fb',
  '#9ceafc', '#a4f7fd', '#a2e8bc', '#a1dd9d', '#9cda96', '#95d28a', '#91ce83', '#8ac778', '#85c270', '#7fbc64',
  '#7bb85e', '#74b254', '#70ad4e', '#6aa644', '#67a23f', '#619a36', '#5e9733', '#669e37', '#6ca33b', '#77ac42',
  '#7db146', '#8bba4f', '#93bf54', '#a1c95d', '#aace63', '#bad86c', '#c3de72', '#d3e77c', '#dded81', '#edf68c',
  '#f8fc92', '#f7f68e', '#f4ee8a', '#f1e484', '#edde80', '#e9d279', '#e6cb75', '#e2c270', '#e0bc6c', '#deb164',
  '#dbaa61', '#d59d57', '#d09652', '#ca8949', '#c78143', '#c1743a', '#bc6d35', '#b7612d', '#b45a28', '#b05325',
  '#a7451e', '#a13f1c', '#a13f1c', '#973b1f', '#933920', '#903823', '#903823', '#87352b', '#84342f', '#803333',
  '#803333', '#843839', '#84393b', '#8f4447', '#94494d', '#994f53', '#9d5457', '#a85f61', '#b2696a', '#b66e70',
  '#bb7378', '#c88089', '#ca8390', '#d08da7', '#d290ae', '#dba0c4', '#dba2cc', '#e2add5', '#e3b6e0', '#e4c0ee',
  '#e5c5f4', '#e0bcee', '#dbb1e8', '#d3a8e3', '#c89dde', '#bd91d9', '#b98dd5', '#b083cb', '#a97ac2', '#9a6fb7',
  '#8e64b0', '#8359ab', '#8153a4', '#7e4897', '#7c418f', '#7b3c88', '#7a3a86', '#78347c', '#77337a', '#732a67',
  '#752b5d'
];
var TLUT = (function () {
  var out = [], base = TCOL.map(hex);
  for (var v = TMIN; v <= TMAX; v += 0.25) {
    var i = Math.min(Math.floor(v - TMIN), base.length - 2), f = v - TMIN - i, a = base[i], b = base[i + 1];
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
  }
  return out;
})();
function tIdx(v) { return clamp(Math.round((v - TMIN) * 4), 0, TLUT.length - 1); }
function band(v, T) { if (!(v >= T[0])) return -1; var k = 0; while (k < T.length - 1 && v >= T[k + 1]) k++; return k; }
var RATE_RGB = RATE_C.map(hex), RAIN_RGB = RAIN_C.map(hex), FRZR_RGB = FRZR_C.map(hex), SLEET_RGB = SLEET_C.map(hex), SNOWR_RGB = SNOWR_C.map(hex);
var ACC_RGB = ACC_C.map(hex);
var SNOW_RGB = SNOW_C.map(hex);

// 2 m dewpoint: one color per degree F from -90 to 130 (Tropical Tidbits' color bar), blended to quarter degrees
var DMIN = -90, DMAX = 130;
var DCOL = [
  '#769eec', '#769eec', '#769eec', '#769eec', '#769eec', '#4c669a', '#2f3f61', '#769eec', '#769eec', '#769eec',
  '#769eec', '#769eec', '#769eec', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#f7f2fb',
  '#e2c9f0', '#dfc8e9', '#dab8e5', '#dbaee3', '#d8a7dc', '#d49dd4', '#d393cc', '#d28dc4', '#d28dc4', '#d07dba',
  '#d07dba', '#cf6daf', '#ce66aa', '#ce64a8', '#cd5fa3', '#cc599c', '#cc579a', '#cb4c85', '#cb4c85', '#cb4c85',
  '#cb4c85', '#cb4c85', '#cb4c85', '#cb4c85', '#c94b85', '#c24a83', '#c24a83', '#bf4982', '#bf4982', '#bf4982',
  '#bd4982', '#b84a83', '#b64a83', '#b44b83', '#b44b83', '#b44b83', '#b44b83', '#af4d83', '#af5089', '#a84c83',
  '#ac5087', '#ae548e', '#ac5b94', '#ac5b94', '#ac5f9b', '#ac5f9b', '#ac669e', '#ac72aa', '#ad78b2', '#b67db1',
  '#b684c1', '#a77bb5', '#a673b9', '#9d71b8', '#936bb3', '#8e6ab3', '#8561ad', '#7954a6', '#7851a2', '#714ca3',
  '#6f55a4', '#7154a6', '#7c61a8', '#8774b5', '#8874b8', '#9d91c6', '#a297cb', '#b3acd9', '#b9b7dd', '#d2d2de',
  '#d2d2de', '#b9b7dd', '#b9b7dd', '#a19ed1', '#9c98cf', '#8b83c4', '#867cc0', '#7773bd', '#6f69bc', '#5757bc',
  '#5757bc', '#5757bc', '#5757bc', '#5757bc', '#5759be', '#5c67d1', '#595fc5', '#6072df', '#6174e2', '#6174e2',
  '#6174e2', '#6b8feb', '#6f97ee', '#75a3f2', '#77a7f3', '#7fb6f7', '#81b9f7', '#8bccf9', '#8dcffa', '#98e3fb',
  '#9ae5fc', '#a4f7fd', '#a2f2e7', '#a1dd9d', '#9fdc9b', '#95d28a', '#94d188', '#8ac778', '#88c675', '#7fbc64',
  '#7dbb62', '#74b254', '#73b052', '#6aa644', '#69a442', '#619a36', '#609935', '#669e37', '#68a038', '#77ac42',
  '#79ae43', '#8bba4f', '#8ebc51', '#a1c95d', '#a4cb5f', '#bad86c', '#bdda6e', '#d3e77c', '#d7e97e', '#edf68c',
  '#f1f88e', '#f7f68e', '#f6f38d', '#f1e484', '#efe283', '#e9d279', '#e8d078', '#e2c270', '#e0ba6a', '#dbb466',
  '#dcb668', '#cfa15a', '#cfa15a', '#c68344', '#c68344', '#c37a3e', '#bf7239', '#b7602d', '#b7602d', '#b05225',
  '#ad4e23', '#a03e1c', '#a03e1c', '#973b1e', '#973b1e', '#8f3722', '#8f3722', '#87352b', '#8b3626', '#803333',
  '#803333', '#803533', '#803933', '#904447', '#954b4e', '#9c5357', '#9c5357', '#a96065', '#b1686d', '#b56c6d',
  '#bc7576', '#c38094', '#c38097', '#c786a7', '#c887a9', '#d99cca', '#dda6d0', '#deacd6', '#deacd6', '#e5c5f4',
  '#e5c5f4', '#dfb9ec', '#deb8ec', '#d4a9e3', '#d4a9e3', '#be92d5', '#b88bd1', '#ae82c8', '#b182c8', '#a072b8',
  '#926cb4', '#815ca9', '#8157a3', '#774a99', '#774a99', '#763a85', '#763a83', '#763074', '#763074', '#763074',
  '#763074'
];
var DLUT = (function () {
  var out = [], base = DCOL.map(hex);
  for (var v = DMIN; v <= DMAX; v += 0.25) {
    var i = Math.min(Math.floor(v - DMIN), base.length - 2), f = v - DMIN - i, a = base[i], b = base[i + 1];
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
  }
  return out;
})();
function dIdx(v) { return clamp(Math.round((v - DMIN) * 4), 0, DLUT.length - 1); }
// 10 m wind speed: Tropical Tidbits bands, 2 knots wide from 4 kt (below 4 kt stays white). Shaded on those knot break points, labelled in mph.
var WIND_T = [4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50, 52, 54, 56, 58, 60, 62, 64, 66, 68, 70, 72, 74, 76, 78, 80, 82, 84, 86];
var WIND_C = [
  '#bdf9fd', '#ade7ef', '#9fd8e2', '#90c7d3', '#81b6c4', '#74a7b7', '#6796a9', '#5a879c',
  '#6dad4a', '#7cbc58', '#95cc66', '#b3db74', '#d6ed83', '#fafd93', '#f0df6e', '#e1ad56',
  '#d77e3f', '#d15b2c', '#cf4a22', '#af3e1b', '#8e3015', '#6e230d', '#4f1b12', '#9438f4',
  '#9f45f4', '#ac5cf4', '#bc78f6', '#cd97f7', '#dfb7f9', '#f1d7fb', '#eccbe7', '#e9bdd3',
  '#e4afc0', '#e0a2ad', '#dd969b', '#d98683', '#d87e77', '#d57060', '#bf6057', '#a95050',
  '#924148', '#7d3143'
];
var WIND_RGB = WIND_C.map(hex);
var KT2MPH = 1.15078;
