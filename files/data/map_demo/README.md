# Vector-tile demo

Side-by-side experiment with the Quarto/leaflet build at `code/app/`. Same
data, same UI controls — but rendered with maplibre-gl from a PMTiles
file, so per-view payload drops from ~50 MB to a few hundred KB and
sub-pixel polygons stop washing out at low zoom.

## Files

- `build_tiled.R` — one script that produces everything below.
- `tracts.geojson` — intermediate, deleted-safe.
- `tracts.pmtiles` — the tile pyramid the page reads.
- `index.html` — the embeddable page.

## Build

From the project root:

```
Rscript code/app/tiled/build_tiled.R
```

Requires WSL with tippecanoe installed (`wsl tippecanoe --version`
should print a version).

The R step takes ~20 s. tippecanoe takes 2–5 min.

## Test locally

Browsers refuse range requests on `file://` URLs, and PMTiles needs them.
Run a tiny static server:

```
Rscript -e 'servr::httd("code/app/tiled", port = 4321)'
```

Open <http://localhost:4321> in your browser. (Python alternative if you
have it: `python -m http.server 4321 --directory code/app/tiled`.)

## Hand to the client

Two files: `index.html` + `tracts.pmtiles`. They upload both to a folder
on their web server and embed via:

```html
<iframe src="/aian-map/index.html"
        width="100%" height="800" style="border:0;"></iframe>
```

Their server only needs to serve static files with HTTP range request
support — every modern web server has that on by default.
