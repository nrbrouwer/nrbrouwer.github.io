library(grid)
library(jpeg)

# general structure for giving title and notes for any figure for the papers page

img <- jpeg::readJPEG("files/images/doipaper_fuding_region.jpg")

jpeg("files/images/test.jpg", width = 10, height = 5, units = "in", res = 300, quality = 100)
grid.newpage()
grid.raster(img, x = 0.5, y = 0.5, width = 0.9, height = 0.75)
grid.text("Distribution of Per Capita Interior Funding Across Regions by Quintile ",
          x = 0.5, y = 0.96,
          gp = gpar(fontsize = 16, fontface = "bold"))

grid.lines(x = c(0.15, 0.85), y = c(0.12, 0.12),
           gp = gpar(col = "grey40", lwd = 0.5))

grid.text("Note:",
          x = 0.05, y = 0.08,
          just = "left",
          gp = gpar(fontsize = 9, fontface = "bold.italic"))
grid.text("Tribes ranked into quintiles by per capita Department of the Interior funding and grouped by geographic",
          x = 0.5, y = 0.08,
          gp = gpar(fontsize = 9, col = "grey20"))
grid.text("region, bars show each region's representation within each funding quintile.",
          x = 0.5, y = 0.06,
          gp = gpar(fontsize = 9, col = "grey20"))
dev.off()