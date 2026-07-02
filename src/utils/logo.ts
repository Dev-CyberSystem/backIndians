// Logo "indians" para los comprobantes PDF.
// El isotipo (molinete de 4 pétalos) se dibuja como vector a partir de los
// mismos paths del favicon de la tienda (viewBox 0 0 2000 2000, con la
// transformación interna translate(0,2000) scale(0.1,-0.1)). El wordmark se
// dibuja con la tipografía Helvetica-BoldOblique, coherente con el logotipo.

// Los 4 subpaths del molinete (extraídos de frontIndians/public/favicon.svg).
const MARK_PATHS = [
  'M5580 19544 c-885 -44 -1675 -256 -2417 -647 -1671 -883 -2795 -2532 -2998 -4397 -37 -349 -38 -819 0 -1182 81 -780 312 -1518 684 -2183 86 -153 192 -325 200 -325 3 0 24 28 46 62 109 170 300 417 466 603 129 145 416 428 554 546 625 537 1384 941 2180 1160 496 137 971 199 1508 199 914 -1 1752 -199 2547 -603 824 -419 1529 -1025 2062 -1774 58 -81 111 -158 119 -170 8 -13 17 -23 21 -23 12 0 192 308 283 485 409 787 625 1665 626 2550 1 1159 -321 2236 -954 3185 -888 1331 -2328 2240 -3897 2459 -296 42 -778 67 -1030 55 z',
  'M14010 19544 c-676 -27 -1317 -162 -1925 -406 -276 -111 -604 -278 -868 -441 -79 -49 -96 -63 -84 -72 9 -5 75 -52 149 -103 1018 -705 1808 -1790 2168 -2979 462 -1525 275 -3150 -520 -4507 -253 -432 -525 -782 -895 -1152 -277 -277 -481 -449 -808 -677 l-108 -75 103 -64 c847 -528 1817 -816 2835 -844 918 -25 1827 175 2643 582 269 135 402 210 615 351 1170 774 2015 1951 2364 3293 113 436 168 823 178 1260 27 1174 -269 2248 -889 3225 -213 336 -447 625 -758 936 -254 255 -388 373 -605 536 -760 571 -1639 941 -2560 1077 -307 45 -754 71 -1035 60 z',
  'M5580 11494 c-41 -2 -160 -11 -265 -19 -1770 -146 -3377 -1130 -4328 -2651 -502 -803 -790 -1714 -846 -2679 -11 -181 0 -636 19 -845 67 -712 284 -1453 607 -2070 273 -521 587 -953 997 -1368 472 -479 975 -841 1566 -1128 605 -295 1213 -465 1925 -541 210 -22 847 -25 1040 -5 643 69 1178 201 1700 422 293 124 870 434 870 468 0 6 -54 48 -121 94 -431 300 -803 641 -1136 1041 -690 828 -1129 1839 -1263 2902 -29 231 -36 332 -42 615 -11 533 38 976 167 1485 111 437 233 764 438 1171 373 737 906 1387 1557 1899 109 85 297 222 394 286 24 15 23 16 -135 111 -766 460 -1605 730 -2479 797 -146 11 -550 20 -665 15 z',
  'M9383 8813 c-478 -770 -762 -1641 -833 -2558 -14 -180 -14 -660 0 -840 70 -904 340 -1753 797 -2508 300 -495 669 -937 1099 -1319 535 -474 1146 -837 1823 -1083 1437 -521 3046 -434 4416 241 262 129 413 215 630 359 941 623 1664 1493 2105 2530 221 521 357 1064 422 1685 17 166 17 840 0 1010 -98 956 -378 1777 -873 2558 -7 12 -16 22 -19 22 -3 0 -27 -35 -55 -77 -76 -117 -239 -334 -352 -468 -606 -720 -1375 -1279 -2243 -1629 -734 -295 -1565 -435 -2355 -398 -1388 67 -2666 615 -3674 1577 -246 234 -572 623 -770 918 -28 42 -53 77 -55 77 -1 0 -30 -44 -63 -97 z',
].join(' ');

/**
 * Dibuja el logo "indians" (isotipo + wordmark) en la posición indicada.
 * @param x        borde izquierdo del logo
 * @param y        borde superior del logo
 * @param markSize alto/ancho del isotipo (px). El wordmark se escala en proporción.
 */
export function drawIndiansLogo(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  markSize = 30,
): void {
  // Isotipo (molinete) — vector escalado al cuadro markSize x markSize.
  doc.save();
  doc.translate(x, y)
    .scale(markSize / 2000)
    .translate(0, 2000)
    .scale(0.1, -0.1)
    .path(MARK_PATHS)
    .fill('#000000');
  doc.restore();

  // Wordmark "indians" a la derecha del isotipo.
  const fontSize = markSize * 0.9;
  const gap = markSize * 0.28;
  doc.fillColor('#000000')
    .font('Helvetica-BoldOblique')
    .fontSize(fontSize)
    .text('indians', x + markSize + gap, y + (markSize - fontSize) / 2 + fontSize * 0.06, {
      lineBreak: false,
    });
}
