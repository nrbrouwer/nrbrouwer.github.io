library(grid)
library(jpeg)

setwd("C:/Users/Nickb/Box/acwebsite")

# --- Configuration --------------------------------------------------------- #
input_file  <- "files/images/main_results_ifect.jpg"
output_file <- "files/images/sgc_effect_display.jpg"

title_text <- paste0(
  "Effect of Self-Governance Compacts on ",
  "Economic Development Proxies Over Time"
)

# Combine all note text into one string; the script handles wrapping.
note_text <- paste(
  "Outcome measures are share of reservation with developed land (top)",
  "and average nighttime light intensity (bottom).",
  "Estimates produced by IFEct estimator (Liu et al. 2024).",
  "Unit of analysis is American Indian reservations and tribal areas."
)

# --- Layout parameters ----------------------------------------------------- #
output_width_in <- 8
output_res      <- 300
title_size      <- 16
note_size       <- 9
img_margin_x    <- 0.05
title_margin    <- 0.08        # space at top for (possibly wrapped) title
note_margin     <- 0.08         # space at bottom for notes
left_pad        <- 0.08         # left edge for notes / line
right_pad       <- 0.08
title_wrap_chars <- 55          # approx chars before title wraps

# --- Derive output height from image aspect ratio ------------------------- #
img    <- jpeg::readJPEG(input_file)
aspect <- nrow(img) / ncol(img)

img_area_w     <- 1 - 2 * img_margin_x
img_area_h_npc <- img_area_w * aspect
canvas_h_npc   <- img_area_h_npc / (1 - title_margin - note_margin)
output_height_in <- output_width_in * canvas_h_npc

img_y_centre <- note_margin + (1 - title_margin - note_margin) / 2

# --- Render ---------------------------------------------------------------- #
jpeg(output_file,
     width  = output_width_in,
     height = output_height_in,
     units  = "in", res = output_res, quality = 100)

grid.newpage()

# Image (no distortion — dimensions follow native aspect ratio)
grid.raster(img,
            x      = 0.5,
            y      = img_y_centre,
            width  = img_area_w,
            height = img_area_h_npc / canvas_h_npc)

# --- Title (wrapped) ------------------------------------------------------ #
title_lines <- strwrap(title_text, width = title_wrap_chars)
title_line_h <- convertHeight(
  grobHeight(textGrob("Xg", gp = gpar(fontsize = title_size))),
  "npc", valueOnly = TRUE
) * 1.3

title_top <- 1 - title_margin * 0.2
for (i in seq_along(title_lines)) {
  grid.text(title_lines[i],
            x  = 0.5,
            y  = title_top - (i - 1) * title_line_h,
            gp = gpar(fontsize = title_size, fontface = "bold"))
}

# --- Divider line ---------------------------------------------------------- #
line_y <- note_margin - 0.005
grid.lines(x = c(left_pad, 1 - right_pad), y = c(line_y, line_y),
           gp = gpar(col = "grey40", lwd = 0.5))

# --- Notes ----------------------------------------------------------------- #
# Measure the "Note:" label so continuation lines align with the text start.
label_grob <- textGrob("Note:",
                       gp = gpar(fontsize = note_size, fontface = "bold.italic"))
label_w <- convertWidth(grobWidth(label_grob), "npc", valueOnly = TRUE)
gap     <- 0.015                        # whitespace between label and text
text_x  <- left_pad + label_w + gap     # x where note text begins

# Wrap width: measure average character width at note size, then figure out
# how many characters fit between text_x and the right margin.
avg_char_w <- convertWidth(
  grobWidth(textGrob(note_text, gp = gpar(fontsize = note_size))),
  "npc", valueOnly = TRUE
) / nchar(note_text)
available_w   <- (1 - right_pad) - text_x
note_wrap_chars <- floor(available_w / avg_char_w)

# Wrap the note text
wrapped <- strwrap(note_text, width = note_wrap_chars)

# Vertical spacing
note_line_h <- convertHeight(
  grobHeight(textGrob("Xg", gp = gpar(fontsize = note_size))),
  "npc", valueOnly = TRUE
) * 1.4

note_top <- line_y - 0.02

# "Note:" label — aligned with the first line of text
grid.text("Note:",
          x    = left_pad,
          y    = note_top,
          just = "left",
          gp   = gpar(fontsize = note_size, fontface = "bold.italic"))

# Note body — every line (including the first) starts at text_x
for (i in seq_along(wrapped)) {
  grid.text(wrapped[i],
            x    = text_x,
            y    = note_top - (i - 1) * note_line_h,
            just = "left",
            gp   = gpar(fontsize = note_size, col = "grey20"))
}

dev.off()

message("Saved: ", output_file,
        " (", output_width_in, " x ",
        round(output_height_in, 2), " in)")