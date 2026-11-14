/**
 * The weekly plan as a PNG, for a chat group: a title, a column per day, and
 * per category the rows that hold someone. Drawn on a canvas in the light
 * theme whatever the page's theme, as it is read on other people's phones.
 */

/** What the image shows. */
export interface WeeklyPlanImage {
  title: string;
  days: { name: string; date: string }[];
  categories: { name: string; rows: (WeeklyPlanImageCell | null)[][] }[];
}

export interface WeeklyPlanImageCell {
  label: string;
  /** The employee's palette colour; none for a deactivated employee. */
  color?: string;
  /** Planned on a day the employee is absent. */
  absent: boolean;
}

export interface WeeklyPlanImageLayout {
  width: number;
  height: number;
  categoryWidth: number;
  dayWidth: number;
}

type Measure = (text: string, font: string) => number;

const PADDING = 24;
const TITLE_HEIGHT = 48;
const HEADER_HEIGHT = 48;
const ROW_HEIGHT = 34;
const CELL_PADDING = 12;
// Sharp on phone screens, which show the image at twice its CSS size or more.
const SCALE = 2;

// A canvas knows no CSS variables, as a PDF doesn't: these are the light
// theme's values. The text is the dark the grid keeps on the pastel tints, the
// dates the tertiary text, which stays readable on the header's grey.
const COLORS = {
  background: "#ffffff",
  text: "#1a1a1a",
  muted: "#767676",
  border: "#d9d9d9",
  header: "#fafafa",
  absentText: "#c62828",
  absentBackground: "#fff1f0",
};

const fonts = (family: string) => ({
  title: `600 20px ${family}`,
  bold: `600 14px ${family}`,
  plain: `14px ${family}`,
});

/** Each category's rows that hold someone; one with nobody keeps a single
 *  empty row, so the category still shows. */
export function filledRows(
  rows: (WeeklyPlanImageCell | null)[][],
  dayCount: number,
): (WeeklyPlanImageCell | null)[][] {
  const filled = rows.filter((row) => row.some(Boolean));
  return filled.length > 0 ? filled : [Array(dayCount).fill(null)];
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export function layOutWeeklyPlanImage(
  image: WeeklyPlanImage,
  measure: Measure,
  family: string,
): WeeklyPlanImageLayout {
  const font = fonts(family);
  const widest = (texts: string[], textFont: string) =>
    Math.max(0, ...texts.map((text) => measure(text, textFont)));
  const labels = image.categories.flatMap((category) =>
    category.rows.flat().flatMap((cell) => (cell ? [cell.label] : [])),
  );
  const categoryWidth = clamp(
    widest(image.categories.map((category) => category.name), font.bold) +
      2 * CELL_PADDING,
    100,
    240,
  );
  const dayWidth = clamp(
    Math.max(
      widest(labels, font.plain),
      widest(image.days.map((day) => day.name), font.bold),
      widest(image.days.map((day) => day.date), font.plain),
    ) +
      2 * CELL_PADDING,
    96,
    200,
  );
  const rowCount = image.categories.reduce(
    (count, category) => count + category.rows.length,
    0,
  );
  const tableWidth = categoryWidth + image.days.length * dayWidth;
  return {
    width:
      2 * PADDING + Math.max(tableWidth, measure(image.title, font.title)),
    height: 2 * PADDING + TITLE_HEIGHT + HEADER_HEIGHT + rowCount * ROW_HEIGHT,
    categoryWidth,
    dayWidth,
  };
}

/** ``text`` cut to ``maxWidth`` with an ellipsis, as the canvas measures it. */
function fitText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (context.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && context.measureText(`${cut}…`).width > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut}…`;
}

function drawHeader(
  context: CanvasRenderingContext2D,
  image: WeeklyPlanImage,
  layout: WeeklyPlanImageLayout,
  family: string,
  top: number,
) {
  const font = fonts(family);
  const left = PADDING + layout.categoryWidth;
  context.fillStyle = COLORS.header;
  context.fillRect(
    PADDING,
    top,
    layout.categoryWidth + image.days.length * layout.dayWidth,
    HEADER_HEIGHT,
  );
  context.textAlign = "center";
  image.days.forEach((day, index) => {
    const center = left + index * layout.dayWidth + layout.dayWidth / 2;
    context.font = font.bold;
    context.fillStyle = COLORS.text;
    context.fillText(day.name, center, top + 20);
    context.font = font.plain;
    context.fillStyle = COLORS.muted;
    context.fillText(day.date, center, top + 38);
  });
}

function drawCell(
  context: CanvasRenderingContext2D,
  cell: WeeklyPlanImageCell,
  layout: WeeklyPlanImageLayout,
  x: number,
  y: number,
) {
  const background = cell.absent ? COLORS.absentBackground : cell.color;
  if (background) {
    context.fillStyle = background;
    context.fillRect(x + 3, y + 3, layout.dayWidth - 6, ROW_HEIGHT - 6);
  }
  context.fillStyle = cell.absent ? COLORS.absentText : COLORS.text;
  context.fillText(
    fitText(context, cell.label, layout.dayWidth - 2 * CELL_PADDING),
    x + layout.dayWidth / 2,
    y + ROW_HEIGHT / 2 + 5,
  );
}

function drawLine(
  context: CanvasRenderingContext2D,
  y: number,
  width: number,
  lineWidth: number,
) {
  context.fillStyle = COLORS.border;
  context.fillRect(PADDING, y, width, lineWidth);
}

export function drawWeeklyPlanImage(
  context: CanvasRenderingContext2D,
  image: WeeklyPlanImage,
  layout: WeeklyPlanImageLayout,
  family: string,
) {
  const font = fonts(family);
  const tableWidth = layout.categoryWidth + image.days.length * layout.dayWidth;
  context.fillStyle = COLORS.background;
  context.fillRect(0, 0, layout.width, layout.height);

  context.textAlign = "left";
  context.font = font.title;
  context.fillStyle = COLORS.text;
  context.fillText(image.title, PADDING, PADDING + 24);

  let y = PADDING + TITLE_HEIGHT;
  drawHeader(context, image, layout, family, y);
  y += HEADER_HEIGHT;
  for (const category of image.categories) {
    drawLine(context, y - 1, tableWidth, 2);
    category.rows.forEach((row, rowIndex) => {
      if (rowIndex > 0) drawLine(context, y, tableWidth, 1);
      if (rowIndex === 0) {
        context.textAlign = "left";
        context.font = font.bold;
        context.fillStyle = COLORS.text;
        context.fillText(
          fitText(context, category.name, layout.categoryWidth - CELL_PADDING),
          PADDING + CELL_PADDING / 2,
          y + ROW_HEIGHT / 2 + 5,
        );
      }
      context.textAlign = "center";
      context.font = font.plain;
      row.forEach((cell, dayIndex) => {
        if (!cell) return;
        const x = PADDING + layout.categoryWidth + dayIndex * layout.dayWidth;
        drawCell(context, cell, layout, x, y);
      });
      y += ROW_HEIGHT;
    });
  }
  context.strokeStyle = COLORS.border;
  context.lineWidth = 1;
  context.strokeRect(
    PADDING + 0.5,
    PADDING + TITLE_HEIGHT + 0.5,
    tableWidth - 1,
    y - PADDING - TITLE_HEIGHT - 1,
  );
}

/** The image as a PNG, in the app's own font. */
export async function renderWeeklyPlanPng(
  image: WeeklyPlanImage,
): Promise<Blob> {
  await document.fonts?.ready;
  const family = getComputedStyle(document.body).fontFamily || "sans-serif";
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No 2D canvas");
  const layout = layOutWeeklyPlanImage(
    image,
    (text, textFont) => {
      context.font = textFont;
      return context.measureText(text).width;
    },
    family,
  );
  // Sizing the canvas resets its context, so the drawing comes after.
  canvas.width = Math.ceil(layout.width * SCALE);
  canvas.height = Math.ceil(layout.height * SCALE);
  context.scale(SCALE, SCALE);
  drawWeeklyPlanImage(context, image, layout, family);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("No PNG"))),
      "image/png",
    );
  });
}
