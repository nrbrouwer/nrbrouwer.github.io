# Build vector-tile demo: code/app/tiled/{tracts.pmtiles, index.html}
#
# Run from project root:
#   Rscript code/app/tiled/build_tiled.R
#
# Requires WSL with tippecanoe installed:
#   wsl tippecanoe --version
#
# Then test locally:
#   Rscript -e 'servr::httd("code/app/tiled", port = 4321)'
# and open http://localhost:4321

wd <- "C:/Users/Nickb/Dropbox/urban_aian_project"
setwd(wd)

suppressPackageStartupMessages({
  library(sf)
  library(dplyr)
  library(jsonlite)
  library(scales)
  library(tigris)
})

options(tigris_use_cache = TRUE)

# 50 states + DC (no territories — same set used in prep_app_data.R)
state_fips_keep <- c(
  "01","02","04","05","06","08","09","10","11","12","13","15","16","17","18",
  "19","20","21","22","23","24","25","26","27","28","29","30","31","32","33",
  "34","35","36","37","38","39","40","41","42","44","45","46","47","48","49",
  "50","51","53","54","55","56"
)

source("code/app/_helpers.R")

out_dir <- "code/app/tiled"
dir.create(out_dir, showWarnings = FALSE, recursive = TRUE)

# ---------------------------------------------------------------------------
# 1. Load + prep tracts
# ---------------------------------------------------------------------------

cat("Loading tracts...\n")
tracts <- read_sf("data/processed_data/app/tracts_2020_ruca.gpkg")

national_alone    <- sum(tracts$ai_alone,                   na.rm = TRUE)
national_combined <- sum(tracts$ai_alone_or_plus_one_other, na.rm = TRUE)

tracts <- tracts |>
  mutate(primary_ruca = as.integer(primary_ruca))

# Compute log-scale ranges for each of the three share metrics. The map
# expressions recompute these on the fly in JS from raw counts, so we only
# need the min/max here to position the color stops.
log10_pos <- function(x) ifelse(x > 0, log10(x), NA_real_)

# National-share metrics use a log scale (otherwise a few large counts would
# crush everything else into the lightest color).
log_alone_vec    <- log10_pos(tracts$ai_alone / national_alone)
log_combined_vec <- log10_pos(tracts$ai_alone_or_plus_one_other / national_combined)

alone_min    <- min(log_alone_vec,    na.rm = TRUE)
alone_max    <- max(log_alone_vec,    na.rm = TRUE)
combined_min <- min(log_combined_vec, na.rm = TRUE)
combined_max <- max(log_combined_vec, na.rm = TRUE)

# Tract-concentration metrics are linear (the natural 0–~1 range gives a
# meaningful continuum without a log transform).
local_alone_vec    <- ifelse(tracts$total_pop > 0,
                             tracts$ai_alone / tracts$total_pop, NA_real_)
local_combined_vec <- ifelse(tracts$total_pop > 0,
                             tracts$ai_alone_or_plus_one_other / tracts$total_pop,
                             NA_real_)

local_alone_max    <- max(local_alone_vec,    na.rm = TRUE)
local_combined_max <- max(local_combined_vec, na.rm = TRUE)

# Sentinel for missing log_share so the JS paint expression has a real number
# to test against.
SENTINEL <- -999

# Tile attributes: only the raw inputs that the JS paint expressions need.
# Share metrics get computed on the fly so we never have to rebuild tiles
# when the colour rules change.
tracts_export <- tracts |>
  select(tract_fips,
         ruca = primary_ruca,
         total_pop, ai_alone, ai_plus_one_other,
         ai_alone_or_plus_one_other)

# ---------------------------------------------------------------------------
# 2. Export GeoJSON for tippecanoe
# ---------------------------------------------------------------------------

gj <- file.path(out_dir, "tracts.geojson")
force_geojson <- nzchar(Sys.getenv("FORCE_REBUILD"))
if (force_geojson || !file.exists(gj)) {
  if (file.exists(gj)) file.remove(gj)
  cat("Writing", gj, "...\n")
  sf::st_write(tracts_export, gj, driver = "GeoJSON", quiet = TRUE)
} else {
  cat("Reusing existing", gj, "(set FORCE_REBUILD=1 to rebuild).\n")
}

# ---------------------------------------------------------------------------
# 3. Run tippecanoe via WSL
# ---------------------------------------------------------------------------

to_wsl_path <- function(p) {
  p <- normalizePath(p, winslash = "/", mustWork = FALSE)
  sub("^([A-Za-z]):/", "/mnt/\\L\\1\\E/", p, perl = TRUE)
}

gj_wsl  <- to_wsl_path(file.path(getwd(), gj))
pmt     <- file.path(out_dir, "tracts.pmtiles")
pmt_wsl <- to_wsl_path(file.path(getwd(), pmt))

# Skip the slow tippecanoe step if the .pmtiles already exists and is newer
# than the .geojson. Set FORCE_REBUILD=1 in the environment to override.
force_rebuild <- nzchar(Sys.getenv("FORCE_REBUILD"))
needs_build   <- force_rebuild || !file.exists(pmt) ||
                 file.info(pmt)$mtime < file.info(gj)$mtime

if (needs_build) {
  if (file.exists(pmt)) file.remove(pmt)
  cat("Running tippecanoe (this takes a few minutes)...\n")
  status <- system2(
    "wsl",
    c("tippecanoe",
      "-o", pmt_wsl,
      "--layer=tracts",
      "--maximum-zoom=10",
      "--minimum-zoom=0",
      "--coalesce-densest-as-needed",
      "--extend-zooms-if-still-dropping",
      "--no-tile-size-limit",
      "--force",
      gj_wsl)
  )
  if (status != 0) stop("tippecanoe failed (exit ", status, ")")
} else {
  cat("Reusing existing", pmt, "(set FORCE_REBUILD=1 to rebuild).\n")
}

pmt_size_mb <- round(file.info(pmt)$size / 1024 / 1024, 1)
cat("Tile file:", pmt, "(", pmt_size_mb, "MB )\n")

# ---------------------------------------------------------------------------
# 3b. State boundaries (small companion GeoJSON for the toggleable line layer)
# ---------------------------------------------------------------------------

states_gj <- file.path(out_dir, "states.geojson")
if (force_geojson || !file.exists(states_gj)) {
  cat("Pulling state boundaries via tigris...\n")
  states_sf <- tigris::states(year = 2020, cb = TRUE, progress_bar = FALSE) |>
    dplyr::filter(STATEFP %in% state_fips_keep) |>
    sf::st_transform(4326) |>
    dplyr::select(STATEFP, NAME)

  prev_s2 <- sf::sf_use_s2(FALSE); on.exit(sf::sf_use_s2(prev_s2), add = TRUE)
  states_sf <- states_sf |>
    sf::st_make_valid() |>
    sf::st_simplify(dTolerance = 0.005, preserveTopology = FALSE)
  states_sf <- states_sf[!sf::st_is_empty(states_sf), ]

  if (file.exists(states_gj)) file.remove(states_gj)
  sf::st_write(states_sf, states_gj, driver = "GeoJSON", quiet = TRUE)
  cat("Wrote", states_gj, "(",
      round(file.info(states_gj)$size / 1024, 1), "KB )\n")
} else {
  cat("Reusing", states_gj, "\n")
}

# ---------------------------------------------------------------------------
# 3c. Tribal-land buffers + per-buffer population counts
#
# For each AIANNH polygon we compute four buffered geometries (5/10/15/20 mi)
# in addition to the original (0 mi). Block-level population is then summed
# for each (AIANNHCE × buffer_miles) by spatial-joining block centroids to the
# buffered polygon set.
#
# Note on overlap: blocks within multiple reservations' buffered areas are
# counted once per reservation. National totals across reservations therefore
# double-count people in overlap zones — the popup shows what users intuitively
# expect ("how many people live within X miles of *this* reservation").
# ---------------------------------------------------------------------------

aianhh_geojson_path <- file.path(out_dir, "aianhh_buffers.geojson")
aianhh_pops_path    <- file.path(out_dir, "aianhh_buffer_pops.rds")
buf_levels <- c(0, 5, 10, 15, 20)

needs_aianhh_build <- force_geojson ||
  !file.exists(aianhh_geojson_path) || !file.exists(aianhh_pops_path)

if (needs_aianhh_build) {
  cat("Building tribal-land buffers + populations (slow on first run)...\n")

  hawaiian_codes <- sprintf("%04d", 5000:5499)
  aianhh_full <- read_sf(
    "data/processed_data/outputs_2020_place_aianhh/aianhh_2020_ai_counts.gpkg"
  ) |>
    dplyr::filter(!is.na(total_pop), !(AIANNHCE %in% hawaiian_codes)) |>
    dplyr::select(AIANNHCE, aianhh_name) |>
    sf::st_transform(5070)   # NAD83 / CONUS Albers — meters

  prev_s2 <- sf::sf_use_s2(FALSE); on.exit(sf::sf_use_s2(prev_s2), add = TRUE)
  aianhh_full <- sf::st_make_valid(aianhh_full)
  cat("  reservations after filtering Hawaiian Homelands:", nrow(aianhh_full), "\n")

  # Pre-compute buffered polygons per level (still in 5070 meters CRS).
  aianhh_bufs <- list()
  for (buf_mi in buf_levels) {
    cat("  Buffering at", buf_mi, "miles...\n")
    if (buf_mi == 0) {
      aianhh_bufs[[as.character(buf_mi)]] <- aianhh_full
    } else {
      aianhh_bufs[[as.character(buf_mi)]] <-
        sf::st_buffer(aianhh_full, dist = buf_mi * 1609.344)
    }
  }

  # Initialize per-buffer accumulators.
  agg_init <- function() {
    tibble::tibble(
      AIANNHCE                    = character(),
      total_pop                   = numeric(),
      ai_alone                    = numeric(),
      ai_plus_one_other           = numeric(),
      ai_alone_or_plus_one_other  = numeric()
    )
  }
  agg_per_buf <- setNames(replicate(length(buf_levels), agg_init(),
                                    simplify = FALSE),
                          as.character(buf_levels))

  # Read block CSV in chunks and aggregate per buffer level.
  block_csv <- "data/raw_data/aian_population/aian_plus/nhgis0027_ds258_2020_block.csv"
  usecols <- c("STATEA", "INTPTLAT", "INTPTLON",
               "U7H001", "U7J004",
               "U7O012", "U7O016", "U7O020", "U7O021", "U7O022")

  i <- 1L
  readr::read_csv_chunked(
    block_csv,
    chunk_size     = 500000,
    show_col_types = FALSE,
    callback = readr::SideEffectChunkCallback$new(function(chunk, pos) {
      cat("  chunk", i, "...\n")

      pts <- chunk |>
        dplyr::select(dplyr::all_of(usecols)) |>
        dplyr::filter(STATEA != 72,                        # exclude PR
                      !is.na(INTPTLAT), !is.na(INTPTLON)) |>
        dplyr::mutate(
          dplyr::across(c(U7H001, U7J004, U7O012, U7O016, U7O020, U7O021, U7O022),
                        ~ tidyr::replace_na(as.numeric(.x), 0)),
          total_pop                  = U7H001,
          ai_alone                   = U7J004,
          ai_plus_one_other          = U7O012 + U7O016 + U7O020 + U7O021 + U7O022,
          ai_alone_or_plus_one_other = ai_alone + ai_plus_one_other
        ) |>
        dplyr::filter(total_pop > 0) |>
        dplyr::select(INTPTLAT, INTPTLON, total_pop, ai_alone,
                      ai_plus_one_other, ai_alone_or_plus_one_other) |>
        sf::st_as_sf(coords = c("INTPTLON", "INTPTLAT"), crs = 4326) |>
        sf::st_transform(5070)

      for (buf_mi in buf_levels) {
        polys <- aianhh_bufs[[as.character(buf_mi)]]
        idx   <- sf::st_intersects(pts, polys)   # sparse list of poly indices

        keep <- lengths(idx) > 0
        if (!any(keep)) next

        # Expand to long: one row per (point, matching reservation)
        rep_pt    <- rep(which(keep), lengths(idx)[keep])
        poly_idx  <- unlist(idx)
        long <- tibble::tibble(
          AIANNHCE                   = polys$AIANNHCE[poly_idx],
          total_pop                  = pts$total_pop[rep_pt],
          ai_alone                   = pts$ai_alone[rep_pt],
          ai_plus_one_other          = pts$ai_plus_one_other[rep_pt],
          ai_alone_or_plus_one_other = pts$ai_alone_or_plus_one_other[rep_pt]
        )
        chunk_agg <- long |>
          dplyr::group_by(AIANNHCE) |>
          dplyr::summarize(
            dplyr::across(c(total_pop, ai_alone, ai_plus_one_other,
                            ai_alone_or_plus_one_other),
                          ~ sum(.x, na.rm = TRUE)),
            .groups = "drop"
          )

        agg_per_buf[[as.character(buf_mi)]] <<-
          dplyr::bind_rows(agg_per_buf[[as.character(buf_mi)]], chunk_agg)
      }

      i <<- i + 1L
    })
  )

  # Final aggregation per buffer level.
  agg_final <- list()
  for (buf_mi in buf_levels) {
    agg_final[[as.character(buf_mi)]] <- agg_per_buf[[as.character(buf_mi)]] |>
      dplyr::group_by(AIANNHCE) |>
      dplyr::summarize(
        dplyr::across(c(total_pop, ai_alone, ai_plus_one_other,
                        ai_alone_or_plus_one_other),
                      ~ sum(.x, na.rm = TRUE)),
        .groups = "drop"
      )
  }

  saveRDS(agg_final, aianhh_pops_path)
  cat("Saved", aianhh_pops_path, "\n")

  # Build combined GeoJSON (one feature per reservation × buffer).
  combined_features <- list()
  for (buf_mi in buf_levels) {
    geom <- aianhh_bufs[[as.character(buf_mi)]] |>
      dplyr::left_join(agg_final[[as.character(buf_mi)]], by = "AIANNHCE") |>
      dplyr::mutate(
        buf_miles = buf_mi,
        dplyr::across(c(total_pop, ai_alone, ai_plus_one_other,
                        ai_alone_or_plus_one_other),
                      ~ tidyr::replace_na(.x, 0))
      )
    combined_features[[as.character(buf_mi)]] <- geom
  }

  combined <- do.call(rbind, combined_features) |>
    sf::st_transform(4326) |>
    sf::st_simplify(dTolerance = 0.001, preserveTopology = FALSE)
  combined <- combined[!sf::st_is_empty(combined), ]

  if (file.exists(aianhh_geojson_path)) file.remove(aianhh_geojson_path)
  sf::st_write(combined, aianhh_geojson_path, driver = "GeoJSON", quiet = TRUE)
  cat("Wrote", aianhh_geojson_path, "(",
      round(file.info(aianhh_geojson_path)$size / 1024 / 1024, 1), "MB )\n")

  rm(aianhh_bufs, combined_features); gc()
} else {
  cat("Reusing", aianhh_geojson_path, "and", aianhh_pops_path, "\n")
}

# Build the JS lookup table (per AIANNHCE × buffer-level populations) for
# popups.  This is small (<200 KB) and gets inlined in the HTML.
aianhh_pop_lookup <- readRDS(aianhh_pops_path)

# The processed gpkg's aianhh_name field is unusable (it's FUNCSTAT). The
# NHGIS shapefile has no NAME field either. Pull proper NAMELSAD from
# tigris::native_areas() — these are the Census-style descriptive names like
# "Cherokee Tribal Statistical Area" that users expect to see.
aianhh_names <- tigris::native_areas(year = 2020, cb = TRUE,
                                     progress_bar = FALSE) |>
  sf::st_drop_geometry() |>
  dplyr::transmute(AIANNHCE = AIANNHCE,
                   aianhh_name = NAMELSAD)

# Convert to nested list: code -> { name, pops: { 0: {...}, 5: {...}, ... } }
aianhh_codes <- aianhh_pop_lookup[["0"]]$AIANNHCE
aianhh_lookup_list <- lapply(aianhh_codes, function(code) {
  pops <- list()
  for (buf_mi in buf_levels) {
    row <- aianhh_pop_lookup[[as.character(buf_mi)]] |>
      dplyr::filter(AIANNHCE == code)
    pops[[as.character(buf_mi)]] <- list(
      total_pop                  = if (nrow(row) == 0) 0 else row$total_pop,
      ai_alone                   = if (nrow(row) == 0) 0 else row$ai_alone,
      ai_plus_one_other          = if (nrow(row) == 0) 0 else row$ai_plus_one_other,
      ai_alone_or_plus_one_other = if (nrow(row) == 0) 0 else row$ai_alone_or_plus_one_other
    )
  }
  list(
    name = aianhh_names$aianhh_name[match(code, aianhh_names$AIANNHCE)],
    pops = pops
  )
})
names(aianhh_lookup_list) <- aianhh_codes

aianhh_lookup_json <- jsonlite::toJSON(aianhh_lookup_list, auto_unbox = TRUE)

# Tippecanoe produced the .pmtiles. The intermediate .geojson can be removed
# safely once you trust the build; leave for now to make debugging easier.

# ---------------------------------------------------------------------------
# 4. Write index.html
# ---------------------------------------------------------------------------

ruca_color_map <- as.list(ruca_colors)
ruca_label_map <- as.list(ruca_labels)

share_grad  <- scales::viridis_pal(option = "A", direction = -1)(7)

# Stop spacing for share scales. share_emphasis raises the bottom of the
# palette so dense concentrations pop more (1 = linear, 2 = quadratic, etc.).
share_emphasis <- 1
t_norm <- seq(0, 1, length.out = length(share_grad))^share_emphasis

build_stops_js <- function(stop_lo, stop_hi) {
  stops <- stop_lo + (stop_hi - stop_lo) * t_norm
  paste(
    mapply(function(s, c) sprintf('%.6f, %s', s, toJSON(c, auto_unbox = TRUE)),
           stops, share_grad),
    collapse = ",\n          "
  )
}

alone_stops_js          <- build_stops_js(alone_min,    alone_max)
combined_stops_js       <- build_stops_js(combined_min, combined_max)
local_alone_stops_js    <- build_stops_js(0,            local_alone_max)
local_combined_stops_js <- build_stops_js(0,            local_combined_max)

lightest_share_color <- share_grad[1]

# RUCA legend HTML (one row per code)
ruca_legend_rows <- paste(vapply(names(ruca_color_map), function(k) {
  sprintf('<div><span class="swatch" style="background:%s"></span>%s</div>',
          ruca_color_map[[k]], ruca_label_map[[k]])
}, character(1)), collapse = "")

gradient_swatch <- paste0(
  '<div style="display:flex;align-items:center;gap:6px;">',
    '<span style="font-size:11px;">Lower</span>',
    '<div style="width:140px;height:12px;border:1px solid #888;',
         'background:linear-gradient(to right,', paste(share_grad, collapse = ","), ');"></div>',
    '<span style="font-size:11px;">Higher</span>',
  '</div>'
)

share_legend_html <- paste0(
  '<div style="font-weight:bold;margin-bottom:6px;">Share of national<br/>AIAN population</div>',
  gradient_swatch
)

local_legend_html <- paste0(
  '<div style="font-weight:bold;margin-bottom:6px;">Share of tract pop.<br/>that is AIAN</div>',
  gradient_swatch
)

# Build JS paint-expression match cases for RUCA fill-color.
ruca_match_js <- paste(
  vapply(names(ruca_color_map), function(k) {
    sprintf('%s, %s', k, toJSON(ruca_color_map[[k]], auto_unbox = TRUE))
  }, character(1)),
  collapse = ",\n        "
)

ruca_labels_js <- toJSON(ruca_label_map, auto_unbox = FALSE)

template_path <- file.path(out_dir, "index.template.html")
html <- paste(readLines(template_path, warn = FALSE), collapse = "\n")

substitutions <- list(
  "__LIGHTEST_SHARE_COLOR__"   = toJSON(lightest_share_color, auto_unbox = TRUE),
  "__NATIONAL_ALONE__"         = sprintf("%.0f", national_alone),
  "__NATIONAL_COMBINED__"      = sprintf("%.0f", national_combined),
  "__RUCA_LABELS_JSON__"       = ruca_labels_js,
  "__RUCA_MATCH_CASES__"       = ruca_match_js,
  "__ALONE_STOPS__"            = alone_stops_js,
  "__COMBINED_STOPS__"         = combined_stops_js,
  "__LOCAL_ALONE_STOPS__"      = local_alone_stops_js,
  "__LOCAL_COMBINED_STOPS__"   = local_combined_stops_js,
  "__RUCA_LEGEND_HTML_JSON__"  = toJSON(paste0(
    '<div style="font-weight:bold;margin-bottom:6px;">Urban–rural type</div>',
    ruca_legend_rows
  ), auto_unbox = TRUE),
  "__SHARE_LEGEND_HTML_JSON__" = toJSON(share_legend_html, auto_unbox = TRUE),
  "__LOCAL_LEGEND_HTML_JSON__" = toJSON(local_legend_html, auto_unbox = TRUE),
  "__AIANHH_LOOKUP_JSON__"     = aianhh_lookup_json
)

for (key in names(substitutions)) {
  html <- gsub(key, substitutions[[key]], html, fixed = TRUE)
}

idx <- file.path(out_dir, "index.html")
writeLines(html, idx)
cat("Wrote", idx, "\n\n")

cat("Done. Test locally with:\n")
cat("  Rscript -e 'servr::httd(\"", out_dir, "\", port = 4321)'\n", sep = "")
cat("then open http://localhost:4321 in your browser.\n")
