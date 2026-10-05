# Vendored map libraries

These unmodified distribution files are committed so the application can load its
map controls without a third-party JavaScript or CSS CDN.

| Library | Version | Official package source | License |
| --- | --- | --- | --- |
| Leaflet | 1.9.4 | https://registry.npmjs.org/leaflet/-/leaflet-1.9.4.tgz | BSD 2-Clause, see `leaflet/LICENSE` |
| Leaflet.markercluster | 1.5.3 | https://registry.npmjs.org/leaflet.markercluster/-/leaflet.markercluster-1.5.3.tgz | MIT, see `leaflet.markercluster/MIT-LICENCE.txt` |

The matching source maps, Leaflet marker/layer images, and original license
notices are included. The upstream `dist/` directories are flattened to each
library's directory while preserving the relative `images/` paths.

Map tiles are separate from these libraries and may still require a network
connection. Tile-provider attribution must remain visible in the application.
